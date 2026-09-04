#!/usr/bin/env node
/**
 * Aggregate registry manifests into the published marketplace index.
 *
 * Reads registry/{official,dsh,community}/*.json, enriches every npm-sourced
 * package with registry metadata (latest version, integrity, publish date,
 * month downloads) and a README excerpt, then writes:
 *
 *   dist/index.json   — the document mayfly's /plugin command consumes
 *   dist/catalog.json — the web catalog (adds full READMEs, capped)
 *
 * GitHub-sourced official entries take their README from the in-repo plugin
 * directory. Zero dependencies; Node >= 22.
 *
 * Usage:
 *   node scripts/build-index.mjs [--out <dir>] [--offline]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registryRoot = join(root, 'registry')
const TIERS = ['official', 'dsh', 'community']
const TIER_ORDER = { official: 0, dsh: 1, community: 2 }
const README_EXCERPT_CHARS = 4000
const README_FULL_CAP = 32 * 1024

const args = process.argv.slice(2)
const outDirFlag = args.indexOf('--out')
const outDir = outDirFlag !== -1 ? args[outDirFlag + 1] : join(root, 'dist')
const offline = args.includes('--offline')

async function fetchJson (url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return await response.json()
}

async function fetchText (url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return await response.text()
}

function loadManifests () {
  const manifests = []
  for (const tier of TIERS) {
    const dir = join(registryRoot, tier)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const path = join(dir, name)
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      manifests.push({ manifest, tier, path: relative(root, path).replaceAll('\\', '/') })
    }
  }
  manifests.sort((a, b) =>
    (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || a.manifest.id.localeCompare(b.manifest.id))
  return manifests
}

/** npm registry enrichment, keyed by package name. */
async function npmInfoFor (names) {
  const info = new Map()
  for (const name of names) {
    const encoded = encodeURIComponent(name)
    try {
      const packument = await fetchJson(`https://registry.npmjs.org/${encoded}`)
      const latestTag = packument['dist-tags']?.latest
      if (!latestTag) throw new Error('no dist-tags.latest (package unpublished?)')
      const version = packument.versions?.[latestTag]
      let downloadsMonth = null
      try {
        const downloads = await fetchJson(`https://api.npmjs.org/downloads/point/last-month/${encoded}`)
        downloadsMonth = downloads.downloads ?? null
      } catch {
        // Downloads are cosmetic; tolerate failure.
      }
      info.set(name, {
        latestVersion: latestTag,
        integrity: version?.dist?.integrity ?? null,
        publishedAt: packument.time?.[latestTag] ?? null,
        downloadsMonth,
        readme: (packument.readme ?? version?.readme ?? '').slice(0, README_FULL_CAP) || null
      })
    } catch (error) {
      throw new Error(`npm enrichment failed for ${name}: ${error.message}`)
    }
  }
  return info
}

function localReadmeFor (manifest) {
  for (const row of manifest.install.rows) {
    if (!row.github) continue
    const home = row.github.repo === 'Ephemeral-AI-Lab/dsh-plugins'
    if (!home || !row.github.subdir) continue
    const readme = join(root, row.github.subdir, 'README.md')
    if (existsSync(readme)) return readFileSync(readme, 'utf8').slice(0, README_FULL_CAP)
  }
  return null
}

function plainExcerpt (readme) {
  if (!readme) return null
  return readme.slice(0, README_EXCERPT_CHARS)
}

const records = loadManifests()
const npmNames = new Set()
for (const { manifest } of records) {
  if (manifest.status === 'removed') continue
  for (const row of manifest.install.rows) {
    if (row.npm) npmNames.add(row.name)
  }
}

const npmInfo = offline ? new Map() : await npmInfoFor([...npmNames].sort())

const entries = []
for (const { manifest, tier, path } of records) {
  const entry = { ...manifest, registryPath: path }
  const packages = {}
  let readme = null
  for (const row of manifest.install.rows) {
    if (row.npm) {
      const info = npmInfo.get(row.name)
      if (!info) throw new Error(`${manifest.id}: row ${row.name} has npm source but no registry data`)
      packages[row.name] = info
      if (readme === null) readme = info.readme
    } else if (row.github) {
      packages[row.name] = { latestVersion: null, integrity: null, publishedAt: null, downloadsMonth: null, readme: null }
      if (readme === null) readme = localReadmeFor(manifest)
    }
  }
  entry.npm = packages
  entry.readmeExcerpt = plainExcerpt(readme)
  entry.readme = readme
  entries.push(entry)
}

const generatedAt = new Date().toISOString()
const base = {
  schemaVersion: 1,
  generatedAt,
  counts: {
    total: entries.length,
    bySource: Object.fromEntries(TIERS.map(tier => [tier, entries.filter(e => e.source === tier).length]))
  }
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'index.json'), JSON.stringify({
  ...base,
  entries: entries.map(({ readme, ...entry }) => entry)
}, null, 2) + '\n')
writeFileSync(join(outDir, 'catalog.json'), JSON.stringify({ ...base, entries }, null, 2) + '\n')

console.log(`OK: wrote ${join(relative(root, outDir) || '.', 'index.json')} and catalog.json ` +
  `(${entries.length} entries: ${TIERS.map(t => `${entries.filter(e => e.source === t).length} ${t}`).join(', ')}).`)
