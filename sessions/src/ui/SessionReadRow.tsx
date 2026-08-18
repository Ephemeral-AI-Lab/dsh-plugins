import { useState } from 'react'
import type { ClientContext, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { DisclosureRow, IconBrowseOutline16, IconInspectOutline12, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import css from './SessionReadRow.module.css'

type SessionReadRowProps = ToolCallViewProps & PropsLocale<'conversation'>

export function SessionReadRow({ toolName, block, inspect }: SessionReadRowProps) {
  const [open, setOpen] = useState(false)
  const done = 'kind' in block
  const output = done ? resultText(block) : null
  const sessionId = sessionIdFromCall(block)
  const state = done
    ? block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
    : 'running'
  const expandable = output !== null

  return (
    <div className={css.root} data-state={state} data-tool={toolName}>
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={state === 'error' ? <StateDot state="error" /> : state === 'stopped' ? <StateDot state="warning" /> : <IconBrowseOutline16 size={14} />}
        title="Read session"
        open={open && expandable}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={sessionId !== undefined && <><span className={css.separator} aria-hidden /> <span className={css.summary}>{sessionId}</span></>}
      >
        <div className={css.bodyWrap}>
          {output !== null && <div className={css.outputCard}><span className={css.outputLabel}>OUT</span><pre>{output}</pre></div>}
          {inspect !== undefined && (
            <button type="button" className={css.inspect} onClick={inspect}>
              <IconInspectOutline12 />
              Inspect
            </button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}

export const sessionReadToolview = {
  name: 'session-read-toolview',
  inject: ['slots'],
  apply(ctx: ClientContext): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'session_read', locale: 'conversation' }, SessionReadRow))
  },
}

function sessionIdFromCall(block: ToolCallBlock): string | undefined {
  const argsRaw = 'kind' in block ? block.call?.argsRaw : block.argsRaw
  if (argsRaw === undefined) return undefined
  try {
    const args = JSON.parse(argsRaw) as { session_id?: unknown }
    return typeof args.session_id === 'string' && args.session_id.length > 0 ? args.session_id : undefined
  } catch {
    return undefined
  }
}

function resultText(block: Extract<ToolCallBlock, { kind: 'tool-result' }>): string | null {
  const parts = block.content.map(value => value.type === 'text' ? value.text : JSON.stringify(value, null, 2))
  if (parts.length === 0 && block.error !== undefined) return `${block.error.name}: ${block.error.code}`
  if (parts.length === 0) return null
  return normalizeReadOutput(parts.join('\n'))
}

function normalizeReadOutput(output: string): string {
  const legacy = /^<path>([^\n]+)<\/path>\n<type>session<\/type>\n<content>[\s\S]*<\/content>$/u.exec(output)
  if (legacy !== null) {
    return `Legacy session_read result for ${legacy[1]}. Run session_read again to view reconstructed message blocks.`
  }
  return output
}
