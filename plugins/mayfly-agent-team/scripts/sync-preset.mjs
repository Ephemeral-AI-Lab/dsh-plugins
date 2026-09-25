/** Generate the Team declaration from the pinned ordinary Mayfly preset. */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseDocument, isMap, isSeq } from 'yaml'

const require = createRequire(import.meta.url)
const mayflyRoot = process.env.MAYFLY_SOURCE_ROOT ?? dirname(require.resolve('@ephemeral-ai/mayfly/package.json'))
const source = readFileSync(join(mayflyRoot, 'presets/standard.patch.yml'), 'utf8')
const document = parseDocument(source, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
if (document.errors.length) throw new Error(document.errors.map(error => error.message).join('\n'))
const replaced = new Set(['tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork'])
function removeDelegation(node) {
  if (isSeq(node)) {
    node.items = node.items.filter(item => !isMap(item) || !replaced.has(item.get('id')))
    node.items.forEach(removeDelegation)
  } else if (isMap(node)) node.items.forEach(pair => removeDelegation(pair.value))
}
const config = document.getIn([0, 'insert', 0, 'config'], true)
if (!isMap(config) || config.get('id') !== 'standard') throw new Error('Expected one standard preset declaration')
document.setIn([0, 'insert', 0, 'id'], 'preset-mayfly-agent-team')
config.set('id', 'team')
config.set('name', 'Agent Team')
config.set('description', 'Standard coding tools with opt-in teammates and a shared task board')
config.set('order', 6)
removeDelegation(config.get('plugins', true))
document.commentBefore = ' Generated from Mayfly standard; pnpm preset:sync. Team-only tools are admitted by the plugin.'
// Replace the inherited source-file banner without altering any !!js scalar.
if (isSeq(document.contents) && document.contents.items[0]) document.contents.items[0].commentBefore = undefined
const output = readFileSync(new URL('./runtime.patch.yml', import.meta.url), 'utf8') + '\n' + document.toString({ lineWidth: 0 })
const target = new URL('../cordis.patch.yml', import.meta.url)
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Team preset is stale; run pnpm preset:sync')
} else writeFileSync(target, output)
