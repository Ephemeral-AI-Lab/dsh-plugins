import { isMockToolName } from './parser.js'

export const DEFAULT_WAIT_TIME_MS = 100

export interface MockToolStep {
  readonly tool: string
  readonly args: Record<string, unknown>
}

export interface MockWaitStep {
  readonly wait: number
}

/** Backwards-compatible name retained for consumers of the initial scaffold. */
export type MockDelayStep = MockWaitStep

export interface MockParallelStep {
  readonly parallel: readonly MockToolStep[]
}

export type MockScriptStep = MockToolStep | MockWaitStep | MockParallelStep

export interface MockScript {
  readonly type: 'dsh-mock-script'
  readonly version: 1
  readonly steps: readonly MockScriptStep[]
}

export interface CompiledMockStep {
  readonly sourceIndex: number
  readonly executableIndex: number
  readonly step: MockToolStep | MockParallelStep
  readonly waitBefore: number
  readonly explicitWaitBefore: boolean
}

export interface CompiledMockScript {
  readonly script: MockScript
  readonly steps: readonly CompiledMockStep[]
  readonly executableStepCount: number
}

export type MockScriptErrorCode = 'INVALID_SCRIPT' | 'CONVERSION_MISMATCH'

export class MockScriptError extends Error {
  readonly code: MockScriptErrorCode
  readonly line: number | undefined
  readonly path: string | undefined

  constructor(code: MockScriptErrorCode, message: string, details: { line?: number; path?: string } = {}) {
    super(message)
    this.name = 'MockScriptError'
    this.code = code
    this.line = details.line
    this.path = details.path
  }
}

export class DshJsonlConversionError extends MockScriptError {
  override readonly line: number

  constructor(line: number, message: string, code: MockScriptErrorCode = 'INVALID_SCRIPT', path?: string) {
    super(code, `${path === undefined ? 'DSH JSONL' : `${path}:`} line ${line}: ${message}`, path === undefined ? { line } : { line, path })
    this.name = 'DshJsonlConversionError'
    this.line = line
  }
}

/** Parse and validate canonical JSON with the same validator used by converters. */
export function parseCanonicalScript(input: string, path?: string): MockScript {
  let value: unknown
  try {
    value = JSON.parse(input.replace(/^\uFEFF/, '')) as unknown
  } catch {
    throw new MockScriptError('INVALID_SCRIPT', `${path ?? 'mock script'} is not valid JSON`, path === undefined ? {} : { path })
  }
  return validateMockScript(value, path)
}

/** Validate every canonical field and return a detached, JSON-only script. */
export function validateMockScript(value: unknown, path?: string): MockScript {
  const root = asPlainObject(value, 'script', path)
  assertExactKeys(root, ['type', 'version', 'steps'], 'script', path)
  if (root.type !== 'dsh-mock-script') invalid('type must be "dsh-mock-script"', path)
  if (root.version !== 1) invalid('unsupported script version; expected version 1', path)
  if (!Array.isArray(root.steps)) invalid('steps must be an array', path)

  const steps: MockScriptStep[] = []
  for (const [index, rawStep] of root.steps.entries()) {
    const stepPath = `steps[${index}]`
    const step = asPlainObject(rawStep, stepPath, path)
    const keys = Object.keys(step)
    if (keys.length === 0) invalid(`${stepPath} must contain one step kind`, path)
    if (Object.prototype.hasOwnProperty.call(step, 'tool')) {
      assertExactKeys(step, ['tool', 'args'], stepPath, path)
      steps.push(validateToolStep(step, stepPath, path))
    } else if (Object.prototype.hasOwnProperty.call(step, 'parallel')) {
      assertExactKeys(step, ['parallel'], stepPath, path)
      const members = step.parallel
      if (!Array.isArray(members) || members.length === 0) invalid(`${stepPath}.parallel must be a non-empty array`, path)
      const parallel: MockToolStep[] = []
      for (const [memberIndex, rawMember] of (members as unknown[]).entries()) {
        const memberPath = `${stepPath}.parallel[${memberIndex}]`
        const member = asPlainObject(rawMember, memberPath, path)
        assertExactKeys(member, ['tool', 'args'], memberPath, path)
        parallel.push(validateToolStep(member, memberPath, path))
      }
      steps.push({ parallel })
    } else if (Object.prototype.hasOwnProperty.call(step, 'wait')) {
      assertExactKeys(step, ['wait'], stepPath, path)
      if (!Number.isSafeInteger(step.wait) || (step.wait as number) < 0) {
        invalid(`${stepPath}.wait must be a non-negative safe integer`, path)
      }
      steps.push({ wait: step.wait as number })
    } else {
      invalid(`${stepPath} must be a tool, parallel, or wait step`, path)
    }
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!
    if (isWaitStep(step)) {
      const before = steps[index - 1]
      const after = steps[index + 1]
      if (before === undefined || after === undefined || isWaitStep(before) || isWaitStep(after)) {
        invalid(`wait at steps[${index}] must be strictly between executable steps`, path)
      }
    }
  }
  return { type: 'dsh-mock-script', version: 1, steps }
}

/** Compile implicit and explicit inter-step waits without changing membership. */
export function compileMockScript(value: MockScript, overwriteWaitTimeMs?: number): CompiledMockScript {
  const script = validateMockScript(value)
  if (overwriteWaitTimeMs !== undefined && (!Number.isSafeInteger(overwriteWaitTimeMs) || overwriteWaitTimeMs < 0)) {
    invalid('overwrite wait time must be a non-negative safe integer')
  }

  const executable: CompiledMockStep[] = []
  let pendingWait: number | undefined
  let pendingExplicit = false
  for (const [sourceIndex, step] of script.steps.entries()) {
    if (isWaitStep(step)) {
      pendingWait = overwriteWaitTimeMs ?? step.wait
      pendingExplicit = true
      continue
    }
    const executableIndex = executable.length
    executable.push({
      sourceIndex,
      executableIndex,
      step,
      waitBefore: executableIndex === 0 ? 0 : (pendingWait ?? DEFAULT_WAIT_TIME_MS),
      explicitWaitBefore: executableIndex !== 0 && pendingExplicit,
    })
    pendingWait = undefined
    pendingExplicit = false
  }
  return { script, steps: executable, executableStepCount: executable.length }
}

/** Stable canonical serialization for diagnostics, tests, and future export. */
export function serializeMockScript(value: MockScript): string {
  return JSON.stringify(validateMockScript(value))
}

/**
 * Convert a native DSH JSONL log into canonical mock-script JSON. Results and
 * approvals are evidence only; no historical result is put into the script.
 */
export function convertDshJsonl(input: string, path?: string): MockScript {
  const groups = new Map<string, SourceGroup>()
  let seenRecord = false
  let sawSession = false

  for (const [index, sourceLine] of input.split(/\r?\n/).entries()) {
    const line = index + 1
    const text = sourceLine.trim()
    if (text.length === 0) continue
    seenRecord = true
    const record = parseRecord(text, line, path)
    if (!sawSession) {
      if (record.type !== 'session') throw conversion(line, 'first nonblank record must have type "session"', path)
      sawSession = true
      continue
    }
    if (record.type === 'session') throw conversion(line, 'only one session header is allowed', path)
    const group = groupFor(groups, record, line)
    if (group === undefined) continue
    addRecordTime(group, record, line)
    switch (record.type) {
      case 'step/start':
        break
      case 'assistant/message':
        collectMessageCalls(group, record, line, path)
        break
      case 'assistant/chunk':
        collectAssistantChunk(group, record, line, path)
        break
      case 'tool-call-chunks':
        collectPackedCall(group, record, line, path)
        break
      case 'tool/call':
        collectDurableCall(group, record, line, path)
        break
      default:
        // Normal DSH events such as tool/result and turn boundaries are
        // intentionally ignored after grouping context has been observed.
        break
    }
  }

  if (!seenRecord || !sawSession) throw conversion(1, 'session record is missing', path)

  const orderedGroups = [...groups.values()].sort((left, right) => left.order - right.order)
  const steps: MockScriptStep[] = []
  let previousGroup: SourceGroup | undefined
  for (const group of orderedGroups) {
    const calls = reconcileGroup(group, path)
    if (calls.length === 0) continue
    const normalized = calls.map(call => normalizeCall(call.name, call.rawArguments, call.line, path))
    if (previousGroup !== undefined) {
      const previousTime = previousGroup.lastCallTime
      const nextTime = group.firstCallTime
      if (previousTime !== undefined && nextTime !== undefined) {
        const gap = nextTime - previousTime
        if (!Number.isSafeInteger(gap) || gap < 0) {
          throw conversion(group.firstCallLine, `non-monotonic source time (${previousTime} -> ${nextTime})`, path)
        }
        steps.push({ wait: gap })
      }
    }
    steps.push(normalized.length === 1 ? normalized[0]! : { parallel: normalized })
    previousGroup = group
  }
  if (steps.length === 0) throw conversion(1, 'DSH JSONL contains no executable tool call', path)
  return validateMockScript({ type: 'dsh-mock-script', version: 1, steps }, path)
}

interface JsonObject {
  readonly [key: string]: unknown
}

interface CallCandidate {
  readonly id: string
  readonly name: string
  readonly rawArguments: string
  readonly order: number
  readonly line: number
  readonly representation: string
}

interface PartialCall {
  readonly id: string
  name?: string
  rawArguments: string
  readonly order: number
  readonly line: number
  lastLine: number
  readonly recordLines: number[]
  readonly fragments: ChunkFragment[]
  readonly representation: string
}

interface ChunkFragment {
  readonly order: number
  readonly index: number
  readonly line: number
  readonly text: string
}

interface SourceGroup {
  readonly key: string
  order: number
  firstCallLine: number
  firstCallTime?: number
  lastCallTime?: number
  readonly messageCalls: CallCandidate[]
  readonly completeCalls: CallCandidate[]
  readonly durableCalls: CallCandidate[]
  readonly packedCalls: Map<string, PartialCall>
  readonly deltaCalls: Map<string, PartialCall>
}

function validateToolStep(value: JsonObject, stepPath: string, path?: string): MockToolStep {
  if (typeof value.tool !== 'string' || !isMockToolName(value.tool)) invalid(`${stepPath}.tool is not a valid tool name`, path)
  if (!isPlainObject(value.args)) invalid(`${stepPath}.args must be a JSON object`, path)
  const args = cloneJsonObject(value.args, `${stepPath}.args`, path)
  return { tool: value.tool, args }
}

function reconcileGroup(group: SourceGroup, path?: string): CallCandidate[] {
  const completeCalls = [
    ...group.messageCalls,
    ...group.completeCalls,
    ...group.durableCalls,
  ]
  const hasChunks = group.packedCalls.size > 0 || group.deltaCalls.size > 0
  const chunkCalls = hasChunks ? chunkCandidates(group.packedCalls, group.deltaCalls, path) : []
  const preferredSource = group.messageCalls.length > 0
    ? group.messageCalls
    : group.completeCalls.length > 0
      ? group.completeCalls
      : group.durableCalls.length > 0
        ? group.durableCalls
        : chunkCalls

  // DSH emits packed timing chunks and assistant deltas as transport-level
  // evidence. Complete assistant messages are preferred for the returned
  // script, but they are not allowed to silently hide a conflicting chunk
  // representation. This catches transport divergence before replay begins.
  const preferred = uniqueCalls(preferredSource, path)
  const complete = uniqueCalls(completeCalls, path)
  if (complete.length > 0 && preferred.length !== complete.length) {
    throw conversionMismatch(preferred.at(-1)?.line ?? complete.at(-1)?.line ?? 1, 'complete records disagree about the number of tool calls', path, complete.at(-1)?.line, preferred.at(-1)?.line)
  }
  if (complete.length > 0) {
    const preferredIds = new Set(preferred.map(candidate => candidate.id))
    for (const candidate of complete) {
      if (!preferredIds.has(candidate.id)) {
        throw conversionMismatch(candidate.line, `call ${JSON.stringify(candidate.id)} is not present in the preferred assistant step`, path, candidate.line)
      }
    }
  }
  if (complete.length > 0 && chunkCalls.length > 0) compareCallLists(preferred, chunkCalls, path)
  return (complete.length > 0 ? preferred : chunkCalls).sort((left, right) => left.order - right.order)
}

function uniqueCalls(candidates: readonly CallCandidate[], path?: string): CallCandidate[] {
  const byId = new Map<string, CallCandidate>()
  for (const candidate of candidates) {
    const prior = byId.get(candidate.id)
    if (prior !== undefined && !sameCall(prior, candidate)) {
      throw conversionMismatch(candidate.line, `call ${JSON.stringify(candidate.id)} disagrees about name or arguments`, path, prior.line, candidate.line)
    }
    byId.set(candidate.id, prior ?? candidate)
  }
  return [...byId.values()].sort((left, right) => left.order - right.order)
}

function compareCallLists(complete: readonly CallCandidate[], chunks: readonly CallCandidate[], path?: string): void {
  if (complete.length !== chunks.length) {
    throw conversionMismatch(
      chunks.at(-1)?.line ?? complete.at(-1)?.line ?? 1,
      `complete assistant records contain ${complete.length} call(s), but chunk records contain ${chunks.length}`,
      path,
      complete.at(-1)?.line,
      chunks.at(-1)?.line,
    )
  }
  for (const [index, completeCall] of complete.entries()) {
    const chunkCall = chunks[index]
    if (chunkCall === undefined) continue
    if (completeCall.id !== chunkCall.id) {
      throw conversionMismatch(chunkCall.line, `complete and chunk records disagree about call ordering at position ${index + 1} (${JSON.stringify(completeCall.id)} vs ${JSON.stringify(chunkCall.id)})`, path, completeCall.line, chunkCall.line)
    }
    if (!sameCall(completeCall, chunkCall)) {
      throw conversionMismatch(chunkCall.line, `complete and chunk records disagree about call ${JSON.stringify(chunkCall.id)} name or arguments`, path, completeCall.line, chunkCall.line)
    }
  }
}

function sameCall(left: CallCandidate, right: CallCandidate): boolean {
  if (left.name !== right.name) return false
  try {
    return JSON.stringify(JSON.parse(left.rawArguments)) === JSON.stringify(JSON.parse(right.rawArguments))
  } catch {
    return left.rawArguments === right.rawArguments
  }
}

function groupFor(groups: Map<string, SourceGroup>, record: JsonObject, line: number): SourceGroup {
  const data = asOptionalObject(record.data)
  const turn = data?.turn
  const step = data?.step
  const key = Number.isInteger(turn) && Number.isInteger(step)
    ? `${String(turn)}:${String(step)}`
    : `line:${line}`
  const existing = groups.get(key)
  if (existing !== undefined) {
    existing.order = Math.min(existing.order, recordOrder(record, line))
    return existing
  }
  const created: SourceGroup = {
    key,
    order: recordOrder(record, line),
    firstCallLine: line,
    messageCalls: [],
    completeCalls: [],
    durableCalls: [],
    packedCalls: new Map(),
    deltaCalls: new Map(),
  }
  groups.set(key, created)
  return created
}

function addRecordTime(group: SourceGroup, record: JsonObject, line: number): void {
  if (typeof record.time !== 'number') return
  if (!Number.isSafeInteger(record.time) || record.time < 0) {
    throw conversion(line, 'time must be a non-negative safe integer')
  }
  group.firstCallTime = group.firstCallTime === undefined ? record.time : Math.min(group.firstCallTime, record.time)
  group.lastCallTime = group.lastCallTime === undefined ? record.time : Math.max(group.lastCallTime, record.time)
  group.firstCallLine = Math.min(group.firstCallLine, line)
}

function collectMessageCalls(group: SourceGroup, record: JsonObject, line: number, path?: string): void {
  const data = requiredObject(record.data, line, 'data', path)
  const message = requiredObject(data.message, line, 'data.message', path)
  if (!Array.isArray(message.content)) throw conversion(line, 'data.message.content must be an array', path)
  for (const [index, value] of message.content.entries()) {
    const block = asOptionalObject(value)
    if (block?.type !== 'tool-call') continue
    group.messageCalls.push(candidateFromBlock(block, line, index, 'assistant/message', path))
  }
}

function collectAssistantChunk(group: SourceGroup, record: JsonObject, line: number, path?: string): void {
  const data = requiredObject(record.data, line, 'data', path)
  const chunk = requiredObject(data.chunk, line, 'data.chunk', path)
  if (chunk.type === 'block-end') {
    const block = requiredObject(chunk.block, line, 'data.chunk.block', path)
    if (block.type === 'tool-call') group.completeCalls.push(candidateFromBlock(block, line, 0, 'assistant/chunk', path))
    return
  }
  if (chunk.type !== 'tool-call-delta') return
  const id = requiredString(chunk.id, line, 'tool-call-delta.id', path)
  const partial = group.deltaCalls.get(id) ?? createPartialCall(id, recordOrder(record, line), line, 'assistant/chunk')
  touchPartial(partial, line)
  if (chunk.name !== undefined) {
    if (typeof chunk.name !== 'string') throw conversion(line, 'tool-call-delta.name must be a string', path)
    if (partial.name !== undefined && partial.name !== chunk.name) {
      throw conversionMismatch(line, `call ${JSON.stringify(id)} disagrees about name`, path, partial.line, line)
    }
    partial.name = chunk.name
  }
  const fragment = chunk.argumentsDelta
  if (typeof fragment !== 'string') throw conversion(line, 'tool-call-delta.argumentsDelta must be a string', path)
  appendFragment(partial, fragment, line, recordOrder(record, line), 0)
  group.deltaCalls.set(id, partial)
}

function collectPackedCall(group: SourceGroup, record: JsonObject, line: number, path?: string): void {
  const data = requiredObject(record.data, line, 'data', path)
  const id = requiredString(data.id, line, 'tool-call-chunks.id', path)
  const name = requiredString(data.name, line, 'tool-call-chunks.name', path)
  const partial = group.packedCalls.get(id) ?? createPartialCall(id, recordOrder(record, line), line, 'tool-call-chunks')
  touchPartial(partial, line)
  if (partial.name !== undefined && partial.name !== name) {
    throw conversionMismatch(line, `call ${JSON.stringify(id)} disagrees about name`, path, partial.line, line)
  }
  partial.name = name
  const order = recordOrder(record, line)
  if (Array.isArray(data.args)) {
    for (const [index, fragment] of data.args.entries()) {
      if (typeof fragment !== 'string') throw conversion(line, 'tool-call-chunks.args must contain strings', path)
      appendFragment(partial, fragment, line, order, index)
    }
  } else if (typeof data.arguments === 'string') {
    appendFragment(partial, data.arguments, line, order, 0)
  } else {
    throw conversion(line, 'tool-call-chunks requires args fragments or arguments', path)
  }
  group.packedCalls.set(id, partial)
}

function collectDurableCall(group: SourceGroup, record: JsonObject, line: number, path?: string): void {
  const data = requiredObject(record.data, line, 'data', path)
  const id = requiredString(data.callId, line, 'tool/call.callId', path)
  const name = requiredString(data.name, line, 'tool/call.name', path)
  const rawArguments = requiredString(data.arguments, line, 'tool/call.arguments', path)
  group.durableCalls.push({ id, name, rawArguments, order: recordOrder(record, line), line, representation: 'tool/call' })
}

function candidateFromBlock(block: JsonObject, line: number, index: number, representation: string, path?: string): CallCandidate {
  const id = requiredString(block.id, line, `${representation}.id`, path)
  const name = requiredString(block.name, line, `${representation}.name`, path)
  const rawArguments = requiredString(block.arguments, line, `${representation}.arguments`, path)
  return { id, name, rawArguments, order: line * 1_000 + index, line, representation }
}

function chunkCandidates(primary: Map<string, PartialCall>, supplement: Map<string, PartialCall>, path?: string): CallCandidate[] {
  const ids = new Set([...primary.keys(), ...supplement.keys()])
  return [...ids]
    .map(id => [primary.get(id), supplement.get(id)].filter((part): part is PartialCall => part !== undefined))
    .sort((left, right) => (left[0]?.order ?? 0) - (right[0]?.order ?? 0))
    .map(parts => {
      const first = parts[0]!
      const name = parts.find(part => part.name !== undefined)?.name
      if (name === undefined) {
        throw incompleteChunk(parts, `${first.representation} call ${JSON.stringify(first.id)} is missing a tool name`, path)
      }
      for (const part of parts) {
        if (part.name !== undefined && part.name !== name) {
          throw conversionMismatch(part.line, `call ${JSON.stringify(first.id)} disagrees about name`, path, first.line, part.line)
        }
      }
      return {
        id: first.id,
        name,
        rawArguments: completeChunkArguments(parts, path),
        order: first.order,
        line: first.line,
        representation: parts.map(part => part.representation).join('+'),
      }
    })
}

function completeChunkArguments(parts: readonly PartialCall[], path?: string): string {
  const nonEmpty = parts.filter(part => part.rawArguments.length > 0)
  if (nonEmpty.length === 0) throw incompleteChunk(parts, 'chunk call has no argument fragments', path)

  // Packed records and assistant deltas can describe one transport stream in
  // an interleaved order. Reassemble the actual fragment order before
  // treating one representation as a complete JSON value. The previous
  // representation-by-representation merge misclassified a valid stream as
  // a conflict when its packed fragments surrounded assistant deltas.
  const fragments = parts
    .flatMap(part => part.fragments)
    .sort((left, right) => left.order - right.order || left.line - right.line || left.index - right.index)
  let combined = ''
  for (const fragment of fragments) combined += fragment.text
  if (isJsonText(combined)) return combined

  const complete = nonEmpty.filter(part => isJsonText(part.rawArguments))
  if (complete.length > 1) {
    const first = complete[0]!
    for (const candidate of complete.slice(1)) {
      if (!sameJsonText(first.rawArguments, candidate.rawArguments)) {
        throw conversionMismatch(candidate.line, `call ${JSON.stringify(first.id)} has conflicting complete chunk arguments`, path, first.line, candidate.line)
      }
    }
    for (const part of nonEmpty) {
      if (complete.includes(part)) continue
      if (!hasEquivalentMerge(first.rawArguments, part.rawArguments)) {
        throw conversionMismatch(part.line, `call ${JSON.stringify(first.id)} has a chunk fragment that conflicts with its complete arguments`, path, first.line, part.line)
      }
    }
    return first.rawArguments
  }
  if (complete.length === 1) {
    const completeText = complete[0]!.rawArguments
    for (const part of nonEmpty) {
      if (part === complete[0]) continue
      if (!hasEquivalentMerge(completeText, part.rawArguments)) {
        throw conversionMismatch(part.line, `call ${JSON.stringify(complete[0]!.id)} has a chunk fragment that conflicts with its complete arguments`, path, complete[0]!.line, part.line)
      }
    }
    return completeText
  }

  combined = nonEmpty[0]!.rawArguments
  for (const part of nonEmpty.slice(1)) combined += part.rawArguments
  if (isJsonText(combined)) return combined
  throw incompleteChunk(parts, `chunk call ${JSON.stringify(nonEmpty[0]!.id)} does not contain complete JSON arguments`, path)
}

function hasEquivalentMerge(completeText: string, fragment: string): boolean {
  if (fragment.length === 0) return true
  const forward = mergeChunkText(completeText, fragment)
  const reverse = mergeChunkText(fragment, completeText)
  return (isJsonText(forward) && sameJsonText(forward, completeText))
    || (isJsonText(reverse) && sameJsonText(reverse, completeText))
}

function sameJsonText(left: string, right: string): boolean {
  try {
    return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right))
  } catch {
    return left === right
  }
}

function incompleteChunk(parts: readonly PartialCall[], message: string, path?: string): DshJsonlConversionError {
  const first = parts[0]!
  const records = [...new Set(parts.flatMap(part => part.recordLines))].sort((left, right) => left - right)
  const recordLabel = records.length === 1 ? `record ${records[0]}` : `records ${records.join(', ')}`
  return conversion(first.line, `${message} (${recordLabel})`, path)
}

function createPartialCall(id: string, order: number, line: number, representation: string): PartialCall {
  return { id, order, rawArguments: '', line, lastLine: line, recordLines: [line], fragments: [], representation }
}

function appendFragment(partial: PartialCall, text: string, line: number, order: number, index: number): void {
  partial.rawArguments += text
  partial.fragments.push({ text, line, order, index })
}

function touchPartial(partial: PartialCall, line: number): void {
  partial.lastLine = line
  if (partial.recordLines.at(-1) !== line) partial.recordLines.push(line)
}

function isJsonText(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function mergeChunkText(first: string, second: string): string {
  if (first.length === 0) return second
  if (second.length === 0) return first
  if (second.startsWith(first)) return second
  if (first.endsWith(second)) return first
  const maximumOverlap = Math.min(first.length, second.length)
  for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
    if (first.endsWith(second.slice(0, overlap))) return first + second.slice(overlap)
  }
  return first + second
}

function normalizeCall(name: string, rawArguments: string, line: number, path?: string): MockToolStep {
  if (!isMockToolName(name)) throw conversion(line, `invalid tool name ${JSON.stringify(name)}`, path)
  let args: unknown
  try {
    args = JSON.parse(rawArguments) as unknown
  } catch {
    throw conversion(line, 'tool arguments must be valid JSON', path)
  }
  if (!isPlainObject(args)) throw conversion(line, 'tool arguments must be a JSON object', path)
  return { tool: name, args: cloneJsonObject(args, 'tool arguments', path) }
}

function parseRecord(text: string, line: number, path?: string): JsonObject {
  try {
    const value = JSON.parse(text) as unknown
    if (!isPlainObject(value)) throw conversion(line, 'record must be a JSON object', path)
    return value
  } catch (error: unknown) {
    if (error instanceof DshJsonlConversionError) throw error
    throw conversion(line, 'record must be valid JSON', path)
  }
}

function recordOrder(record: JsonObject, line: number): number {
  const sequence = record.seq ?? record.seq0
  if (sequence === undefined) return line
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw conversion(line, 'seq must be a non-negative safe integer')
  }
  return sequence
}

function requiredObject(value: unknown, line: number, label: string, path?: string): JsonObject {
  if (!isPlainObject(value)) throw conversion(line, `${label} must be an object`, path)
  return value
}

function requiredString(value: unknown, line: number, label: string, path?: string): string {
  if (typeof value !== 'string' || value.length === 0) throw conversion(line, `${label} must be a non-empty string`, path)
  return value
}

function asOptionalObject(value: unknown): JsonObject | undefined {
  return isPlainObject(value) ? value : undefined
}

function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJsonObject(value: JsonObject, label: string, path?: string): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) output[key] = cloneJsonValue(child, `${label}.${key}`, path)
  return output
}

function cloneJsonValue(value: unknown, label: string, path?: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(`${label} must contain JSON values`, path)
    return value
  }
  if (Array.isArray(value)) return value.map((child, index) => cloneJsonValue(child, `${label}[${index}]`, path))
  if (isPlainObject(value)) return cloneJsonObject(value, label, path)
  invalid(`${label} must contain JSON values`, path)
}

function assertExactKeys(value: JsonObject, expected: readonly string[], label: string, path?: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${label} has unknown or missing properties`, path)
  }
}

function asPlainObject(value: unknown, label: string, path?: string): JsonObject {
  if (!isPlainObject(value)) invalid(`${label} must be a JSON object`, path)
  return value
}

function isWaitStep(step: MockScriptStep): step is MockWaitStep {
  return 'wait' in step
}

function invalid(message: string, path?: string): never {
  throw new MockScriptError('INVALID_SCRIPT', path === undefined ? message : `${path}: ${message}`, path === undefined ? {} : { path })
}

function conversion(line: number, message: string, path?: string): DshJsonlConversionError {
  return new DshJsonlConversionError(line, message, 'INVALID_SCRIPT', path)
}

function conversionMismatch(line: number, message: string, path?: string, firstLine?: number, secondLine?: number): DshJsonlConversionError {
  const locations = firstLine === undefined || secondLine === undefined ? '' : ` (records ${firstLine} and ${secondLine})`
  return new DshJsonlConversionError(line, `${message}${locations}`, 'CONVERSION_MISMATCH', path)
}
