import type { ReadSessionMessage, ReadSessionResult } from './types.js'

export function formatReadSessionOutput(value: ReadSessionResult): string {
  const body = value.messages.length === 0
    ? '(No messages in this window)'
    : value.messages.map(formatMessage).join('\n\n')
  const endOffset = value.offset + value.messages.length - 1
  const footer = endOffset < value.total_messages
    ? `(Showing messages ${value.offset}-${endOffset} of ${value.total_messages})`
    : `(End of session - total ${value.total_messages} messages)`
  return [
    `Session ${value.session_id}`,
    body,
    '',
    footer,
  ].join('\n')
}

function formatMessage(message: ReadSessionMessage): string {
  const shape = message as unknown as {
    role?: unknown
    source?: { kind?: unknown }
    content?: unknown
  }
  const label = shape.source?.kind === 'tool'
    ? 'TOOL'
    : shape.source?.kind === 'plugin'
      ? 'CONTEXT'
      : typeof shape.role === 'string' ? shape.role.toUpperCase() : 'MESSAGE'
  const blocks = Array.isArray(shape.content) ? shape.content : []
  const content = blocks.length === 0
    ? '(Empty message)'
    : blocks.map(formatContentBlock).join('\n')
  return `[${label}]\n${content}`
}

function formatContentBlock(value: unknown): string {
  const block = value as { type?: unknown; text?: unknown; name?: unknown; arguments?: unknown; content?: unknown; isError?: unknown }
  if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') return block.text
  if (block.type === 'tool-call' && typeof block.name === 'string' && typeof block.arguments === 'string') {
    return `Tool call: ${block.name}\n${formatArguments(block.arguments)}`
  }
  if (block.type === 'tool-result') {
    const status = block.isError === true ? ' (error)' : ''
    const resultBlocks = Array.isArray(block.content) ? block.content : []
    const content = resultBlocks.length === 0
      ? '(Empty result)'
      : resultBlocks.map(formatContentBlock).join('\n')
    return `Tool result${status}\n${content}`
  }
  return JSON.stringify(block, null, 2)
}

function formatArguments(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
