/** Small streaming UTF-8 decoder used by output-facing tests and adapters. */
export class StreamingTextDecoder {
  private readonly decoder = new TextDecoder('utf-8')

  push(bytes: Uint8Array): string {
    return this.decoder.decode(bytes, { stream: true })
  }

  finish(): string {
    return this.decoder.decode()
  }
}
