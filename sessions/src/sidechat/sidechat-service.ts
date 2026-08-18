import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SideChatOpenArgs, SideChatResult } from './sidechat-types.js'

interface SideChatRuntime {
  startContinuable(spec: {
    provider: string
    label: string
    surface?: 'side-chat'
    request: { parent: Agent; prompt: ContentBlock[] }
    signal: AbortSignal
  }): Promise<{ childId: string; messageId: string }>
  followup(
    parent: Agent,
    childId: string,
    content: ContentBlock[],
    options: { source: { kind: 'user' }; signal: AbortSignal },
  ): Promise<string>
}

type SideChatContext = Context & { readonly subagents: SideChatRuntime }

/** Sessions-facing adapter over the Harness continuable-child service. */
export class SideChatService {
  constructor(private readonly ctx: Context) {}

  async open(args: SideChatOpenArgs, parent: Agent | undefined, signal: AbortSignal): Promise<SideChatResult> {
    requireText(args.prompt, 'prompt')
    if (parent === undefined) throw new Error('session_open_sidechat requires a calling agent')
    signal.throwIfAborted()
    const started = await (this.ctx as SideChatContext).subagents.startContinuable({
      provider: 'fork',
      label: sideChatLabel(args.prompt),
      surface: 'side-chat',
      request: {
        parent,
        prompt: [{ type: 'text', text: args.prompt }],
      },
      signal,
    })
    return {
      subagent_id: String(started.childId),
      message_id: String(started.messageId),
      accepted: true,
      status: 'running',
    }
  }

  async send(
    subagentId: string,
    message: string,
    parent: Agent | undefined,
    signal: AbortSignal,
  ): Promise<{ message_id: string }> {
    requireText(subagentId, 'subagent_id')
    requireText(message, 'message')
    if (parent === undefined) throw new Error('side-chat continuation requires a calling agent')
    signal.throwIfAborted()
    const accepted = await (this.ctx as SideChatContext).subagents.followup(
      parent,
      SessionId(subagentId.trim()),
      [{ type: 'text', text: message }],
      {
        source: { kind: 'user' },
        signal,
      },
    )
    return { message_id: String(accepted) }
  }
}

function sideChatLabel(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/gu, ' ')
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
}
