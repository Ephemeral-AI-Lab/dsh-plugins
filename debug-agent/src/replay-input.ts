import { readFile } from 'node:fs/promises'

/**
 * Direct ZIP replay is intentionally unsupported in v1. A ZIP archive is
 * binary data, so treating it as UTF-8 JSONL would produce an ambiguous and
 * misleading parse error. Callers should extract its session.jsonl member and
 * replay that JSONL path instead.
 */
export class ReplayInputError extends Error {
  readonly code = 'UNSUPPORTED_ARCHIVE'
  readonly path: string

  constructor(path: string) {
    super(`UNSUPPORTED_ARCHIVE: ${path}: direct ZIP replay is not supported; extract session.jsonl and replay the extracted JSONL file`)
    this.name = 'ReplayInputError'
    this.path = path
  }
}

/** Read a replay source while rejecting ZIP input before UTF-8 conversion. */
export async function readReplayInput(path: string, signal?: AbortSignal): Promise<string> {
  const bytes = await readFile(path, { signal })
  if (path.toLowerCase().endsWith('.zip') || isZipSignature(bytes)) throw new ReplayInputError(path)
  return bytes.toString('utf8')
}

function isZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false
  return (bytes[2] === 0x03 && bytes[3] === 0x04)
    || (bytes[2] === 0x05 && bytes[3] === 0x06)
    || (bytes[2] === 0x07 && bytes[3] === 0x08)
}
