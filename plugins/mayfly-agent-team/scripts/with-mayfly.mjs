/** Run a plugin command against built Mayfly tarballs, then restore development inputs. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [checkout, separator, command, ...args] = process.argv.slice(2)
if (!checkout || separator !== '--' || !command) throw new Error('Usage: node scripts/with-mayfly.mjs <built-mayfly-checkout> -- <command> [args]')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mayfly = resolve(checkout)
for (const name of ['mayfly', 'ui']) if (!existsSync(join(mayfly, 'packages', name, 'lib', 'index.js'))) throw new Error(`Build Mayfly first: missing packages/${name}/lib/index.js`)
const temp = mkdtempSync(join(tmpdir(), 'mayfly-team-consumer-'))
const originals = new Map(['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'].map(name => [name, existsSync(join(root, name)) ? readFileSync(join(root, name)) : undefined]))
function run(cmd, argv, cwd = root) {
  const result = spawnSync(cmd, argv, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${cmd} exited ${result.status}`)
}
try {
  for (const name of ['mayfly-ui', 'mayfly']) run('pnpm', ['--filter', `@ephemeral-ai/${name}`, 'pack', '--pack-destination', temp], mayfly)
  const manifest = JSON.parse(originals.get('package.json'))
  const overrides = {}
  for (const name of ['mayfly-ui', 'mayfly']) {
    const archive = readdirSync(temp).find(file => file.startsWith(`ephemeral-ai-${name}-0`) && file.endsWith('.tgz'))
    if (!archive) throw new Error(`No packed ${name} package`)
    const spec = `file:${join(temp, archive)}`
    manifest.devDependencies[`@ephemeral-ai/${name}`] = spec
    overrides[`@ephemeral-ai/${name}`] = spec
  }
  const workspace = originals.get('pnpm-workspace.yaml').toString()
  if (/^overrides:/m.test(workspace)) throw new Error('Temporary overrides already exist; restore pnpm-workspace.yaml first')
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(root, 'pnpm-workspace.yaml'), workspace + '\noverrides:\n' + Object.entries(overrides).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}\n`).join(''))
  run('pnpm', ['install', '--no-frozen-lockfile'])
  run(command, args)
} finally {
  for (const [name, bytes] of originals) {
    if (bytes === undefined) rmSync(join(root, name), { force: true })
    else writeFileSync(join(root, name), bytes)
  }
  rmSync(temp, { recursive: true, force: true })
}
