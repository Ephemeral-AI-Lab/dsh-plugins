import { useState, type FormEvent } from 'react'

export function SideChatComposer({ disabled, onSend }: { readonly disabled: boolean; readonly onSend: (message: string) => Promise<void> }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const message = draft.trim()
    if (message === '' || disabled || sending) return
    setSending(true)
    try {
      await onSend(message)
      setDraft('')
    } finally {
      setSending(false)
    }
  }
  return (
    <form className="dsh-sidechat-composer" onSubmit={submit}>
      <textarea value={draft} onChange={event => { setDraft(event.target.value) }} placeholder="Message side chat…" disabled={disabled || sending} rows={3} />
      <button type="submit" disabled={disabled || sending || draft.trim() === ''}>{sending ? 'Sending…' : 'Send'}</button>
    </form>
  )
}
