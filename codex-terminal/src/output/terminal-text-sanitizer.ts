/**
 * Removes terminal control sequences from PTY text before it reaches the
 * model-facing output log. The state is streaming because node-pty may split
 * one ANSI/VT sequence across multiple data events.
 */
export class TerminalTextSanitizer {
  private pending = ''

  push(text: string): string {
    if (text.length === 0 && this.pending.length === 0) return ''
    const input = this.pending + text
    this.pending = ''
    let output = ''
    let cursor = 0

    while (cursor < input.length) {
      const escape = input.indexOf('\u001b', cursor)
      if (escape === -1) {
        output += input.slice(cursor)
        break
      }

      output += input.slice(cursor, escape)
      const sequence = consumeEscapeSequence(input, escape)
      if (sequence === undefined) {
        this.pending = input.slice(escape)
        break
      }
      if (sequence === 0) {
        // An unrecognised escape is not a terminal sequence. Drop only the
        // ESC byte and re-process the following text so printable output is
        // never swallowed with it.
        cursor = escape + 1
      } else {
        cursor = escape + sequence
      }
    }

    return output
  }

  /** Flush text after UTF-8 decoding has finished. Incomplete controls are dropped. */
  finish(text = ''): string {
    const output = this.push(text)
    this.pending = ''
    return output
  }
}

/** Returns the sequence length, zero for an unknown escape, or undefined if incomplete. */
function consumeEscapeSequence(text: string, start: number): number | undefined {
  if (start + 1 >= text.length) return undefined
  const kind = text[start + 1]

  if (kind === '[') return consumeCsi(text, start)
  if (kind === ']' || kind === 'P' || kind === '^' || kind === '_' || kind === 'X') {
    return consumeStringControl(text, start)
  }

  const code = text.charCodeAt(start + 1)
  return code >= 0x30 && code <= 0x7e ? 2 : 0
}

function consumeCsi(text: string, start: number): number | undefined {
  for (let index = start + 2; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) return index - start + 1
    if (code < 0x20 || code > 0x3f) return 0
  }
  return undefined
}

function consumeStringControl(text: string, start: number): number | undefined {
  for (let index = start + 2; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 0x07) return index - start + 1
    if (code === 0x1b) {
      if (index + 1 >= text.length) return undefined
      if (text[index + 1] === '\\') return index - start + 2
    }
  }
  return undefined
}
