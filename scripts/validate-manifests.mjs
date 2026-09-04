#!/usr/bin/env node
/**
 * Validate marketplace manifests under registry/{official,dsh,community}/.
 *
 * Zero-dependency structural validation mirroring
 * registry/schema/plugin-manifest.v1.json. CI additionally runs ajv against
 * the JSON Schema for the authoritative check; this script is the fast local
 * gate that needs no install.
 *
 * Usage: node scripts/validate-manifests.mjs
 * Exits nonzero on the first class of errors; prints all findings.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registryRoot = join(root, 'registry')
const TIERS = ['official', 'dsh', 'community']
const CATEGORIES = ['tools', 'ui', 'provider', 'workflow', 'testing', 'integration']
const STATUSES = ['stable', 'beta', 'unstable', 'deprecated', 'removed']
const TUI_CONTRIBUTIONS = ['panes', 'status', 'overlays', 'editorExtensions']

const errors = []
const warnings = []
const seenIds = new Map()

function fail (file, message) {
  errors.push(`${file}: ${message}`)
}

function checkString (file, manifest, field, { min = 1, max = Infinity, pattern } = {}) {
  const value = manifest[field]
  if (typeof value !== 'string') {
    fail(file, `${field} must be a string`)
    return null
  }
  if (value.length < min || value.length > max) {
    fail(file, `${field} length must be ${min}..${max}`)
    return null
  }
  if (pattern !== undefined && !pattern.test(value)) {
    fail(file, `${field} must match ${pattern}`)
    return null
  }
  return value
}

function checkRow (file, row) {
  if (typeof row.name !== 'string' || !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-._~]+$/.test(row.name)) {
    fail(file, `install row name ${JSON.stringify(row.name)} is not a valid package name`)
  }
  if (row.id !== undefined && (typeof row.id !== 'string' || row.id.length === 0)) {
    fail(file, 'install row id must be a non-empty string when present')
  }
  const activation = row.activation ?? 'bundle'
  if (!['bundle', 'profile-patch'].includes(activation)) {
    fail(file, `install row ${row.name} activation must be bundle or profile-patch`)
  }
  if (activation === 'profile-patch' && typeof row.id !== 'string') {
    fail(file, `install row ${row.name} needs an id for activation=profile-patch`)
  }
  if (row.config !== undefined && (typeof row.config !== 'object' || row.config === null || Array.isArray(row.config))) {
    fail(file, `install row ${row.name} config must be an object`)
  }
  const hasNpm = row.npm !== undefined
  const hasGithub = row.github !== undefined
  if (!hasNpm && !hasGithub) {
    fail(file, `install row ${row.name} must declare npm or github`)
  }
  if (hasNpm) {
    const npm = row.npm
    if (typeof npm !== 'object' || npm === null || Array.isArray(npm)) {
      fail(file, `install row ${row.name} npm must be an object`)
    } else if (typeof npm.spec !== 'string' || npm.spec.length === 0) {
      fail(file, `install row ${row.name} npm.spec must be a non-empty string`)
    }
  }
  if (hasGithub) {
    const github = row.github
    if (typeof github !== 'object' || github === null || Array.isArray(github)) {
      fail(file, `install row ${row.name} github must be an object`)
    } else {
      if (typeof github.repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(github.repo)) {
        fail(file, `install row ${row.name} github.repo must look like owner/repo`)
      }
      if (typeof github.ref !== 'string' || github.ref.length === 0 || github.ref.length > 80) {
        fail(file, `install row ${row.name} github.ref must be 1..80 chars`)
      }
      if (github.subdir !== undefined && (typeof github.subdir !== 'string' || github.subdir.startsWith('/'))) {
        fail(file, `install row ${row.name} github.subdir must be a relative path`)
      }
    }
  }
}

function checkManifest (file, manifest, tier) {
  if (manifest.schemaVersion !== 1) fail(file, 'schemaVersion must be 1')
  if (manifest.source !== tier) fail(file, `source ${JSON.stringify(manifest.source)} must be "${tier}" (matches directory)`)

  const id = checkString(file, manifest, 'id', { pattern: /^[a-z0-9][a-z0-9-]*$/, max: 64 })
  if (id !== null) {
    if (seenIds.has(id)) fail(file, `duplicate id "${id}" (also in ${seenIds.get(id)})`)
    else seenIds.set(id, file)
  }

  checkString(file, manifest, 'displayName', { max: 64 })
  checkString(file, manifest, 'description', { min: 10, max: 300 })
  checkString(file, manifest, 'descriptionZh', { min: 10, max: 300 })
  checkString(file, manifest, 'license', { max: 32 })

  if (!CATEGORIES.includes(manifest.category)) fail(file, `category must be one of ${CATEGORIES.join(', ')}`)
  if (!STATUSES.includes(manifest.status)) fail(file, `status must be one of ${STATUSES.join(', ')}`)
  if ((manifest.status === 'deprecated' || manifest.status === 'removed') &&
      (typeof manifest.statusNote !== 'string' || manifest.statusNote.length === 0)) {
    fail(file, 'statusNote is required when status is deprecated or removed')
  }

  if (typeof manifest.author !== 'object' || manifest.author === null || Array.isArray(manifest.author) ||
      typeof manifest.author.name !== 'string' || manifest.author.name.length === 0) {
    fail(file, 'author.name is required')
  } else if (manifest.author.url !== undefined && typeof manifest.author.url !== 'string') {
    fail(file, 'author.url must be a string')
  }

  if (manifest.links !== undefined) {
    if (typeof manifest.links !== 'object' || manifest.links === null || Array.isArray(manifest.links)) {
      fail(file, 'links must be an object')
    } else {
      for (const key of Object.keys(manifest.links)) {
        if (!['repo', 'docs', 'npm'].includes(key)) fail(file, `links.${key} is not a known link kind`)
        else if (typeof manifest.links[key] !== 'string') fail(file, `links.${key} must be a string`)
      }
    }
  }

  const surfaces = manifest.surfaces
  if (typeof surfaces !== 'object' || surfaces === null || Array.isArray(manifest.surfaces)) {
    fail(file, 'surfaces must be an object')
  } else {
    const keys = Object.keys(surfaces)
    if (keys.length === 0) fail(file, 'surfaces must declare at least one of server/web/tui')
    for (const key of keys) {
      if (!['server', 'web', 'tui'].includes(key)) {
        fail(file, `surfaces.${key} is not a surface`)
        continue
      }
      if (key === 'web' && surfaces.web?.clientModule !== true) {
        fail(file, 'surfaces.web.clientModule must be true')
      }
      if (key === 'tui') {
        const contributions = surfaces.tui?.contributions
        if (!Array.isArray(contributions) || contributions.length === 0 ||
            !contributions.every(c => TUI_CONTRIBUTIONS.includes(c))) {
          fail(file, `surfaces.tui.contributions must be a non-empty subset of ${TUI_CONTRIBUTIONS.join(', ')}`)
        }
        const engines = manifest.engines
        if (typeof engines !== 'object' || engines === null || typeof engines.mayfly !== 'string') {
          fail(file, 'engines.mayfly is required when surfaces.tui is declared')
        }
      }
    }
  }

  if (manifest.provides !== undefined) {
    const provides = manifest.provides
    if (typeof provides !== 'object' || provides === null || Array.isArray(provides)) {
      fail(file, 'provides must be an object')
    } else {
      if (provides.tools !== undefined &&
          (!Array.isArray(provides.tools) || !provides.tools.every(t => /^[a-z][a-z0-9_]*$/.test(t)))) {
        fail(file, 'provides.tools entries must match ^[a-z][a-z0-9_]*$')
      }
      if (provides.commands !== undefined &&
          (!Array.isArray(provides.commands) || !provides.commands.every(c => /^\/[a-z0-9-]+$/.test(c)))) {
        fail(file, 'provides.commands entries must look like /name')
      }
    }
  }

  const rows = manifest.install?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(file, 'install.rows must be a non-empty array')
  } else {
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        fail(file, 'install row must be an object')
      } else {
        checkRow(file, row)
      }
    }
  }
  const allowBuilds = manifest.install?.allowBuilds
  if (allowBuilds !== undefined &&
      (!Array.isArray(allowBuilds) || allowBuilds.length === 0 ||
       !allowBuilds.every(n => typeof n === 'string' && n.length > 0) ||
       new Set(allowBuilds).size !== allowBuilds.length)) {
    fail(file, 'install.allowBuilds must be a non-empty array of unique package names')
  }

  if (manifest.capabilities !== undefined &&
      (!Array.isArray(manifest.capabilities) ||
       !manifest.capabilities.every(c => typeof c === 'string' && c.length <= 40))) {
    fail(file, 'capabilities must be an array of short strings')
  }

  const verified = manifest.verified
  if (verified === undefined) {
    warnings.push(`${file}: no verified block (record one at review time)`)
  } else if (typeof verified !== 'object' || verified === null || Array.isArray(verified)) {
    fail(file, 'verified must be an object')
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(verified.at ?? '')) fail(file, 'verified.at must be YYYY-MM-DD')
    if (!Array.isArray(verified.packages) || verified.packages.length === 0) {
      fail(file, 'verified.packages must be a non-empty array')
    } else {
      for (const pkg of verified.packages) {
        if (typeof pkg?.name !== 'string' || typeof pkg?.version !== 'string') {
          fail(file, 'verified.packages entries need name and version')
        }
        if (pkg?.integrity !== undefined && !/^sha512-[a-z0-9+/=]+$/i.test(pkg.integrity)) {
          fail(file, 'verified.packages integrity must be an sha512 value')
        }
      }
    }
  }

  // Cross-check: every verified package name should appear in install rows.
  const rowNames = new Set((rows ?? []).map(row => row?.name))
  for (const pkg of verified?.packages ?? []) {
    if (pkg?.name !== undefined && !rowNames.has(pkg.name)) {
      warnings.push(`${file}: verified package "${pkg.name}" is not an install row name`)
    }
  }
}

let manifestCount = 0
for (const tier of TIERS) {
  const dir = join(registryRoot, tier)
  let files = []
  try {
    files = readdirSync(dir).filter(name => name.endsWith('.json'))
  } catch {
    warnings.push(`registry/${tier}/ has no manifests yet`)
    continue
  }
  for (const name of files) {
    const file = `registry/${tier}/${name}`
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch (error) {
      fail(file, `invalid JSON: ${error.message}`)
      continue
    }
    manifestCount += 1
    checkManifest(file, manifest, tier)
  }
}

for (const warning of warnings) console.warn(`warn: ${warning}`)
if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`)
  console.error(`\n${errors.length} error(s) across ${manifestCount} manifest(s).`)
  process.exit(1)
}
console.log(`OK: ${manifestCount} manifest(s) validated.`)
