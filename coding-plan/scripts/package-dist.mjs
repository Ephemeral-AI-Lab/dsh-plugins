import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const output = join(root, 'lib')

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

for (const [name, replacement] of [
  ['core', undefined],
  ['codex', ['dsh-coding-plan-core', 'dsh-coding-plan/core']],
  ['grok', ['dsh-coding-plan-core', 'dsh-coding-plan/core']],
]) {
  const source = join(root, name, 'lib')
  const target = join(output, name)
  await cp(source, target, { recursive: true })
  if (replacement === undefined) continue
  for (const file of await readdir(target)) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
    const path = join(target, file)
    const raw = await readFile(path, 'utf8')
    await writeFile(path, raw.replaceAll(replacement[0], replacement[1]))
  }
}
