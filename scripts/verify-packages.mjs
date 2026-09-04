#!/usr/bin/env node
/**
 * Verify that every marketplace install source actually installs.
 *
 * - npm rows: package exists on the registry, latest tarball ships
 *   cordis.patch.yml and declares dsh.bundle.patch. Warns on install
 *   lifecycle scripts and native binaries (disclosure for review).
 * - github rows: scratch-installs the pnpm spec into a temp profile and
 *   checks the installed package declares dsh.bundle.patch. (Git sources
 *   install sources, not artifacts — this catches missing build output.)
 *
 * Usage: node scripts/verify-packages.mjs [--skip-install] [--only <id>] [--github-ref <ref>]
 * Needs pnpm on PATH for github checks (skip with --skip-install).
 *
 * --github-ref substitutes rows pinned to "main" with another ref. CI uses it
 * on PR branches: the registry moves plugin directories, so "main" does not
 * contain the PR's tree until it merges.
 */
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registryRoot = join(root, 'registry')
const TIERS = ['official', 'dsh', 'community']

const args = process.argv.slice(2)
const skipInstall = args.includes('--skip-install')
const onlyFlag = args.indexOf('--only')
const onlyId = onlyFlag !== -1 ? args[onlyFlag + 1] : null
const githubRefFlag = args.indexOf('--github-ref')
const githubRefOverride = githubRefFlag !== -1 ? args[githubRefFlag + 1] : null

const errors = []
const warnings = []

async function fetchJson (url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) return { error: response.status }
  return await response.json()
}

/** Minimal ustar reader: enough to list and extract regular files. */
function tarEntries (buffer) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer)
  const entries = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = String.fromCharCode(...header.subarray(0, 100)).replaceAll('\0', '')
    const prefix = String.fromCharCode(...header.subarray(345, 500)).replaceAll('\0', '')
    const sizeField = String.fromCharCode(...header.subarray(124, 136)).replaceAll('\0', ' ').trim()
    const size = parseInt(sizeField, 8) || 0
    const type = String.fromCharCode(header[156] ?? 0)
    const regular = type === '0' || type === '\0' || type === ''
    entries.push({
      name: prefix ? `${prefix}/${name}` : name,
      size,
      regular,
      data: buffer.subarray(offset + 512, offset + 512 + size)
    })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

async function verifyNpmRow (id, row) {
  const name = row.name
  const packument = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
  if (packument.error === 404) {
    errors.push(`${id}: npm package ${name} not found (unpublished or typo)`)
    return
  }
  const latest = packument['dist-tags']?.latest
  if (!latest) {
    errors.push(`${id}: npm package ${name} has no dist-tags.latest`)
    return
  }
  const version = packument.versions?.[latest]
  const tarballUrl = version?.dist?.tarball
  if (!tarballUrl) {
    errors.push(`${id}: npm package ${name}@${latest} has no tarball URL`)
    return
  }
  const spec = row.npm.spec
  const specWithoutScope = spec.startsWith('@') ? spec.slice(1) : spec
  const manifestVersion = specWithoutScope.includes('@') ? specWithoutScope.split('@').pop() : null
  if (manifestVersion && manifestVersion !== latest) {
    warnings.push(`${id}: ${name} pinned to ${manifestVersion} but registry latest is ${latest}`)
  }
  const response = await fetch(tarballUrl)
  if (!response.ok) {
    errors.push(`${id}: tarball download failed for ${name}@${latest}: HTTP ${response.status}`)
    return
  }
  const entries = tarEntries(Buffer.from(await response.arrayBuffer()))
  const names = entries.filter(e => e.regular).map(e => e.name)
  const has = (file) => names.includes(`package/${file}`)
  if (!has('package.json')) {
    errors.push(`${id}: ${name}@${latest} tarball has no package.json`)
    return
  }
  const inner = JSON.parse(String.fromCharCode(...entries.find(e => e.name === 'package/package.json').data))
  if (row.activation === 'profile-patch') {
    // Activated by an installer-inserted profile patch row; the tarball is not
    // expected to self-declare.
    console.log(`ok: ${id} npm ${name}@${latest} (activation=profile-patch)`)
  } else {
    if (inner.dsh?.bundle?.patch === undefined) {
      errors.push(`${id}: ${name}@${latest} declares no dsh.bundle.patch — dsh would install it as a plain dependency`)
    }
    if (!has('cordis.patch.yml')) {
      errors.push(`${id}: ${name}@${latest} tarball ships no cordis.patch.yml`)
    }
  }
  for (const script of ['preinstall', 'postinstall', 'prepare']) {
    if (inner.scripts?.[script] !== undefined) {
      warnings.push(`${id}: ${name}@${latest} runs a ${script} script on install`)
    }
  }
  if (names.some(n => n.endsWith('.node'))) {
    warnings.push(`${id}: ${name}@${latest} ships native binaries`)
  }
  console.log(`ok: ${id} npm ${name}@${latest}`)
}

function githubSpec (row) {
  const { repo, ref, subdir } = row.github
  const effectiveRef = githubRefOverride !== null && ref === 'main' ? githubRefOverride : ref
  return `github:${repo}#${effectiveRef}${subdir ? `&path:${subdir}` : ''}`
}

function verifyGithubEntry (id, manifest) {
  const rows = manifest.install.rows.filter(row => row.github)
  const specs = rows.map(githubSpec)
  const dir = mkdtempSync(join(tmpdir(), 'market-verify-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'market-verify', private: true }, null, 2))
    const allowBuilds = manifest.install.allowBuilds ?? []
    const allowYaml = allowBuilds.length > 0
      ? 'allowBuilds:\n' + allowBuilds.map(name => `  ${JSON.stringify(name)}: true`).join('\n') + '\n'
      : ''
    // Mirrors the /plugin installer: allowBuilds from the manifest go into
    // the workspace before pnpm add.
    writeFileSync(join(dir, 'pnpm-workspace.yaml'),
      'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n' + allowYaml)
    // All rows install together — exactly what the /plugin installer does, and
    // the only way sibling packages satisfy each other's peer dependencies.
    const result = spawnSync('pnpm', ['add', ...specs], { cwd: dir, encoding: 'utf8', timeout: 240_000 })
    if (result.status !== 0) {
      const tail = (result.stdout + result.stderr).split('\n').filter(Boolean).slice(-5).join(' | ')
      errors.push(`${id}: github scratch install failed for ${specs.join(' ')}: ${tail}`)
      return
    }
    for (const row of rows) {
      const installedPath = join(dir, 'node_modules', row.name, 'package.json')
      if (!existsSync(installedPath)) {
        errors.push(`${id}: github install produced no node_modules/${row.name}`)
        continue
      }
      const installed = JSON.parse(readFileSync(installedPath, 'utf8'))
      if (installed.dsh?.bundle?.patch === undefined) {
        errors.push(`${id}: github-installed ${row.name}@${installed.version} declares no dsh.bundle.patch`)
        continue
      }
      if ((installed.main !== undefined || installed.exports !== undefined) &&
          !existsSync(join(dir, 'node_modules', row.name, 'lib'))) {
        errors.push(`${id}: github-installed ${row.name}@${installed.version} exposes lib but ships no lib/ (commit build output)`)
        continue
      }
      console.log(`ok: ${id} github ${row.github.repo}#${row.github.ref}${row.github.subdir ? `&path:${row.github.subdir}` : ''} -> ${row.name}@${installed.version}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const records = []
for (const tier of TIERS) {
  const dir = join(registryRoot, tier)
  if (!existsSync(dir)) continue
  for (const name of readdirSync(dir).filter(n => n.endsWith('.json'))) {
    records.push(JSON.parse(readFileSync(join(dir, name), 'utf8')))
  }
}

for (const manifest of records) {
  if (onlyId && manifest.id !== onlyId) continue
  if (manifest.status === 'removed') {
    console.log(`skip: ${manifest.id} (removed tombstone)`)
    continue
  }
  const githubRows = []
  for (const row of manifest.install.rows) {
    if (row.npm) await verifyNpmRow(manifest.id, row)
    else if (row.github) githubRows.push(row)
  }
  if (githubRows.length > 0) {
    if (skipInstall) {
      for (const row of githubRows) console.log(`skip: ${manifest.id} github ${githubSpec(row)} (--skip-install)`)
    } else {
      verifyGithubEntry(manifest.id, manifest)
    }
  }
}

for (const warning of warnings) console.warn(`warn: ${warning}`)
if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`)
  console.error(`\n${errors.length} error(s).`)
  process.exit(1)
}
console.log('OK: all install sources verified.')
