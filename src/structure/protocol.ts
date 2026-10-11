import { symbols } from '@deepseek-ai/cordis'
import { isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebstackLspError } from '../errors.js'
import type { CodeCapabilitiesV1, CodeHostBindingV1, CodeIntelligenceServiceV1, CodeLeaseV1, CodeRequestV1, CodeResponseV1, CodeStatus } from '../code-intelligence-contracts.js'
import type { CodeIntelligenceToolServiceV1, SemanticResult, StructureNode } from './types.js'

const CAPABILITIES = ['snapshots', 'structure', 'semantic'] as const
const MAX_FILES = 100
const MAX_INPUT_BYTES = 16 * 1024 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_CALLS = 100
const MAX_BATCH_MS = 30_000
const RESPONSE_BYTES = 32 * 1024

export interface CodeIntelligenceProtocolOptions {
  backend: CodeIntelligenceToolServiceV1
  fs: unknown
  subprocess: unknown
  capabilities(signal: AbortSignal): Promise<CodeCapabilitiesV1>
}

/** Host-bound V1 facade. Each lease owns its handles and cumulative evaluation budget. */
export class CodeIntelligenceProtocolService implements CodeIntelligenceServiceV1 {
  readonly version = 1 as const
  readonly capabilities = CAPABILITIES
  private readonly leases = new Set<CodeLease>()
  private closed = false

  constructor(private readonly options: CodeIntelligenceProtocolOptions) {}

  async bind(binding: CodeHostBindingV1, signal: AbortSignal): Promise<CodeLeaseV1> {
    if (this.closed) throw new WebstackLspError('LSP_DISPOSED', 'code-intelligence service is disposed')
    validateBinding(binding)
    signal.throwIfAborted()
    await binding.assertCurrent()
    const contextFs = binding.context.get('fs', false)
    const contextSubprocess = binding.context.get('subprocess', false)
    if (identity(contextFs) !== identity(this.options.fs) || identity(contextSubprocess) !== identity(this.options.subprocess))
      throw new WebstackLspError('LSP_CODE_INTELLIGENCE_UNAVAILABLE', 'host services do not match the provider scope')
    const scope = {
      ownerId: `${binding.owner.agentId}:code:${randomUUID()}`,
      sessionId: binding.owner.sessionId,
      workspaceRoot: binding.workspaceRoot,
    }
    const lease = new CodeLease(binding, scope, this.options.backend, this.options.capabilities, identity(this.options.fs), identity(this.options.subprocess), () => this.leases.delete(lease))
    this.leases.add(lease)
    try {
      await lease.assertCurrent(signal)
      if (this.closed) throw new WebstackLspError('LSP_DISPOSED', 'code-intelligence service is disposed')
      return lease
    } catch (error) {
      await lease.dispose()
      throw error
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([...this.leases].map(lease => lease.dispose()))
  }
}

class CodeLease implements CodeLeaseV1 {
  private readonly lifetime = new AbortController()
  private readonly snapshots = new Map<string, { version: string; path: string }>()
  private readonly nodes = new Map<string, string>()
  private calls = 0
  private files = 0
  private inputBytes = 0
  private outputBytes = 0
  private readonly started = performance.now()
  private disposed = false
  private disposal?: Promise<void>

  constructor(
    private readonly binding: CodeHostBindingV1,
    private readonly scope: { ownerId: string; sessionId: string; workspaceRoot: string },
    private readonly backend: CodeIntelligenceToolServiceV1,
    private readonly capabilities: (signal: AbortSignal) => Promise<CodeCapabilitiesV1>,
    private readonly fsIdentity: unknown,
    private readonly subprocessIdentity: unknown,
    private readonly onDispose: () => void,
  ) {}

  async assertCurrent(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.disposed) throw new WebstackLspError('LSP_STALE_SNAPSHOT', 'code evaluation has ended')
    await this.binding.assertCurrent()
    if (identity(this.binding.context.get('fs', false)) !== this.fsIdentity || identity(this.binding.context.get('subprocess', false)) !== this.subprocessIdentity)
      throw new WebstackLspError('LSP_STALE_SNAPSHOT', 'host service scope changed')
    signal.throwIfAborted()
  }

  async request(input: CodeRequestV1, caller: AbortSignal): Promise<CodeResponseV1> {
    const release = input?.method === 'snapshot.release'
    if (!release) this.calls++
    if (this.disposed) return this.account(outcome('stale', 'evaluation_closed'))
    if (!validCodeRequest(input)) return this.account(outcome('unsupported', 'invalid_request'))
    if (caller.aborted) return this.account(outcome(caller.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', caller.reason?.name === 'TimeoutError' ? 'caller_deadline' : 'caller_cancelled'))

    if (release) return this.release(input.handle)
    if (this.calls > MAX_CALLS || this.outputBytes >= MAX_OUTPUT_BYTES || this.files >= MAX_FILES && input.method === 'snapshot.open' || this.inputBytes >= MAX_INPUT_BYTES && input.method === 'snapshot.open')
      return this.account(outcome('limit_exceeded', 'evaluation_budget'))
    const remaining = MAX_BATCH_MS - (performance.now() - this.started)
    if (remaining <= 0) return this.account(outcome('timeout', 'batch_deadline'))
    if ('handle' in input && !this.snapshots.has(input.handle) || 'nodeHandle' in input && !this.nodes.has(input.nodeHandle))
      return this.account(outcome('stale', 'unknown_handle'))

    const duration = input.method === 'semantic.query' ? 10_000 : 2_000
    const timeout = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(remaining, duration))))
    const signal = AbortSignal.any([caller, this.lifetime.signal, timeout])
    try {
      await this.assertCurrent(signal)
      let response: CodeResponseV1
      if (input.method === 'capabilities') response = this.capabilitiesResponse(await this.capabilities(signal))
      else if (input.method === 'snapshot.open') response = await this.open(input, signal)
      else response = await this.query(input, signal)
      await this.assertCurrent(signal)
      return this.account(boundResponse(response))
    } catch (error) {
      if (signal.aborted) return this.account(outcome(this.lifetime.signal.aborted || caller.aborted && caller.reason?.name !== 'TimeoutError' ? 'cancelled' : 'timeout', caller.aborted ? caller.reason?.name === 'TimeoutError' ? 'caller_deadline' : 'caller_cancelled' : 'operation_deadline'))
      if (error instanceof WebstackLspError) return this.account(mapError(error))
      return this.account(outcome('unavailable', 'provider_operation_failed'))
    }
  }

  private async open(input: Extract<CodeRequestV1, { method: 'snapshot.open' }>, signal: AbortSignal): Promise<CodeResponseV1> {
    this.files++
    const opened = await this.backend.snapshot.open(this.scope, input.path, signal)
    const version = `${opened.version}:${opened.contentHash}`
    const response: CodeResponseV1 = {
      protocol: 'code-intelligence/v1',
      status: 'ok',
      sourceKind: 'disk',
      freshness: 'pinned',
      snapshotVersion: version,
      truncated: false,
      omitted: 0,
      inputBytes: opened.sourceBytes,
      data: { handle: opened.handle, path: opened.filePath, language: opened.language ?? 'unsupported', parseErrors: opened.parseErrors },
    }
    if (this.inputBytes + opened.sourceBytes > MAX_INPUT_BYTES) {
      await this.backend.snapshot.release(this.scope, opened.handle).catch(() => {})
      return outcome('limit_exceeded', 'input_budget')
    }
    this.inputBytes += opened.sourceBytes
    this.snapshots.set(opened.handle, { version, path: opened.filePath })
    return response
  }

  private async query(input: Exclude<CodeRequestV1, { method: 'capabilities' | 'snapshot.open' | 'snapshot.release' }>, signal: AbortSignal): Promise<CodeResponseV1> {
    const handle = 'handle' in input ? input.handle : this.nodes.get(input.nodeHandle)!
    const snapshot = this.snapshots.get(handle)
    if (!snapshot) return outcome('stale', 'unknown_handle')
    const metadata = { snapshotVersion: snapshot.version, freshness: 'current' as const }
    if (input.method === 'structure.outline') {
      const result = await this.backend.structure.outline(this.scope, input.handle, { ...(input.range ? { range: input.range } : {}), ...(input.limit ? { limit: input.limit } : {}) }, signal)
      const items = result.declarations.map(projectNode)
      this.rememberNodes(handle, items)
      const status = result.truncated && result.status === 'ok' ? 'partial' : result.status
      return responseFor(status, result.status === 'unsupported' ? 'grammar_missing' : result.errors.hasError ? 'parse_errors' : undefined, metadata, { items }, result.truncated, result.truncated ? 1 : 0)
    }
    if (input.method === 'structure.enclosing') {
      const result = await this.backend.structure.enclosing(this.scope, input.handle, input.position, input.kinds ? { kinds: input.kinds } : undefined, signal)
      const items = [...(result.node ? [result.node] : []), ...result.ancestors].map(projectNode)
      this.rememberNodes(handle, items)
      return responseFor(result.status, result.status === 'unsupported' ? 'grammar_missing' : result.errors?.hasError ? 'parse_errors' : undefined, metadata, { items })
    }
    if (input.method === 'structure.query') {
      const result = await this.backend.structure.query(this.scope, input.handle, input.queryId, { ...(input.range ? { range: input.range } : {}), ...(input.limit ? { limit: input.limit } : {}) }, signal)
      const items = result.captures.map(capture => ({ handle: capture.nodeHandle, kind: capture.kind, range: capture.range, ...(capture.name ? { name: capture.name } : {}) }))
      this.rememberNodes(handle, items)
      return responseFor(result.truncated && result.status === 'ok' ? 'partial' : result.status, undefined, metadata, { items, queryId: result.queryId }, result.truncated, result.truncated ? 1 : 0)
    }
    if (input.method === 'structure.span') {
      const result = await this.backend.structure.span(this.scope, input.nodeHandle, input.maxChars, signal)
      return responseFor(result.status, undefined, metadata, { text: result.text, range: result.range }, result.truncated, result.truncated ? 1 : 0)
    }
    return this.semantic(input, metadata, signal)
  }

  private async semantic(input: Extract<CodeRequestV1, { method: 'semantic.query' }>, metadata: { snapshotVersion: string; freshness: 'current' }, signal: AbortSignal): Promise<CodeResponseV1> {
    const result: SemanticResult = await this.backend.semantic.query(this.scope, input.handle, {
      operation: input.kind,
      ...(input.position ? { position: input.position } : {}),
      ...(input.limit ? { maxResults: input.limit } : {}),
    }, signal)
    if (result.status === 'unsupported' || result.status === 'unavailable' || result.status === 'stale' || result.status === 'timeout' || result.status === 'cancelled' || result.status === 'limit_exceeded')
      return responseFor(result.status, `semantic_${result.status}`, metadata)
    const value = result.result
    if (input.kind === 'hover') {
      if (!isRecord(value) || value.kind !== 'hover') return outcome('unavailable', 'semantic_result_invalid')
      const hover = value.hover
      if (hover === null) return responseFor(result.status, undefined, metadata, { hover: null })
      if (!isRecord(hover) || typeof hover.contents !== 'string') return outcome('unavailable', 'semantic_result_invalid')
      const contents = trimUtf16(hover.contents, 16_000)
      const truncated = contents !== hover.contents
      return responseFor(result.status, undefined, metadata, { hover: { contents, ...(hover.range ? { range: hover.range } : {}) } }, truncated, truncated ? hover.contents.length - contents.length : 0)
    }
    if (input.kind === 'completion') {
      if (!isRecord(value) || !Array.isArray(value.items)) return outcome('unavailable', 'semantic_result_invalid')
      let truncated = Boolean(result.truncated)
      const items = value.items.map((item: any) => ({
        label: typeof item.label === 'string' ? item.label.slice(0, 1000) : '',
        ...(typeof item.detail === 'string' ? { detail: item.detail.slice(0, 4000) } : {}),
        ...(typeof item.documentation === 'string' ? { documentation: item.documentation.slice(0, 8000) } : {}),
        ...(Number.isInteger(item.kind) ? { kind: item.kind } : {}),
        ...(typeof item.insertText === 'string' ? { insertText: item.insertText.slice(0, 8000) } : {}),
      }))
      if (items.some((item, index) => item.label !== value.items[index]?.label || item.detail !== value.items[index]?.detail || item.documentation !== value.items[index]?.documentation || item.insertText !== value.items[index]?.insertText)) truncated = true
      const limit = input.limit ?? 200
      const omitted = (result.omitted ?? 0) + Math.max(0, items.length - limit)
      return responseFor(truncated || omitted ? 'partial' : result.status, undefined, metadata, { items: items.slice(0, limit) }, truncated || omitted > 0, omitted)
    }
    if (input.kind === 'diagnostics') {
      if (!isRecord(value) || !Array.isArray(value.diagnostics)) return outcome('unavailable', 'semantic_result_invalid')
      if (value.skipped) return responseFor('unsupported', 'unsupported_file_type', metadata)
      let truncated = Boolean(result.truncated)
      const items = value.diagnostics.map((item: any) => {
        const message = typeof item.message === 'string' ? item.message.slice(0, 8000) : ''
        if (message !== item.message) truncated = true
        return { uri: item.uri, range: item.range, message, ...(Number.isInteger(item.severity) ? { severity: item.severity } : {}) }
      })
      const limit = input.limit ?? 200
      const omitted = (result.omitted ?? 0) + Math.max(0, items.length - limit)
      return responseFor(truncated || omitted || result.status === 'partial' ? 'partial' : result.status, undefined, metadata, { items: items.slice(0, limit) }, truncated || omitted > 0, omitted)
    }
    if (!isRecord(value) || value.kind !== 'locations' || !Array.isArray(value.locations)) return outcome('unavailable', 'semantic_result_invalid')
    return responseFor(result.status, undefined, metadata, { items: value.locations }, Boolean(result.truncated), result.omitted ?? 0)
  }

  private async release(handle: string): Promise<CodeResponseV1> {
    const known = this.snapshots.delete(handle)
    for (const [node, snapshot] of this.nodes) if (snapshot === handle) this.nodes.delete(node)
    if (!known) return responseFor('ok', 'released', { sourceKind: 'disk', freshness: 'unknown' }, { released: false })
    const result = await this.backend.snapshot.release(this.scope, handle)
    return responseFor('ok', 'released', { sourceKind: 'disk', freshness: 'unknown' }, result)
  }

  private capabilitiesResponse(capabilities: CodeCapabilitiesV1): CodeResponseV1 {
    return responseFor('ok', 'capabilities', { sourceKind: 'disk', freshness: 'unknown' }, capabilities)
  }

  private rememberNodes(snapshotHandle: string, items: Array<{ handle: string }>): void {
    for (const item of items) this.nodes.set(item.handle, snapshotHandle)
  }

  private account(response: CodeResponseV1): CodeResponseV1 {
    const bytes = Buffer.byteLength(JSON.stringify(response))
    if (bytes > RESPONSE_BYTES) response = outcome('limit_exceeded', 'response_limit')
    this.outputBytes += Buffer.byteLength(JSON.stringify(response))
    if (this.outputBytes > MAX_OUTPUT_BYTES) return outcome('limit_exceeded', 'response_budget')
    return response
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    this.lifetime.abort()
    this.snapshots.clear()
    this.nodes.clear()
    this.onDispose()
    this.disposal = Promise.resolve(this.backend.releaseOwner?.(this.scope)).then(() => undefined, () => undefined)
    return this.disposal
  }
}

function outcome(status: CodeStatus, reason: string): CodeResponseV1 {
  return { protocol: 'code-intelligence/v1', status, reason, sourceKind: 'disk', freshness: status === 'stale' ? 'stale' : 'unknown', truncated: false, omitted: 0 }
}

function responseFor(status: CodeStatus, reason: string | undefined, metadata: { snapshotVersion?: string; freshness: CodeResponseV1['freshness']; sourceKind?: 'disk' }, data?: unknown, truncated = false, omitted = 0): CodeResponseV1 {
  const successful = status === 'ok' || status === 'partial'
  return { protocol: 'code-intelligence/v1', status, ...(reason ? { reason } : {}), sourceKind: 'disk', freshness: metadata.freshness, ...(metadata.snapshotVersion ? { snapshotVersion: metadata.snapshotVersion } : {}), truncated, omitted, ...(successful && data !== undefined ? { data } : {}) }
}

function boundResponse(response: CodeResponseV1): CodeResponseV1 {
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') <= RESPONSE_BYTES) return response
  if (isRecord(response.data) && Array.isArray(response.data.items)) {
    const items = [...response.data.items]
    let omitted = response.omitted
    while (items.length && Buffer.byteLength(JSON.stringify({ ...response, data: { ...response.data, items } }), 'utf8') > RESPONSE_BYTES) {
      items.pop()
      omitted++
    }
    const shortened: CodeResponseV1 = { ...response, status: 'partial', reason: response.reason ?? 'response_truncated', truncated: true, omitted, data: { ...response.data, items } }
    if (Buffer.byteLength(JSON.stringify(shortened), 'utf8') <= RESPONSE_BYTES) return shortened
  }
  return outcome('limit_exceeded', 'response_limit')
}

function mapError(error: WebstackLspError): CodeResponseV1 {
  if (error.code === 'LSP_STALE_SNAPSHOT') return outcome('stale', 'source_changed')
  if (error.code === 'LSP_STRUCTURE_TIMEOUT') return outcome('timeout', 'parser_deadline')
  if (error.code === 'LSP_STRUCTURE_LIMIT' || error.code === 'LSP_SNAPSHOT_LIMIT') return outcome('limit_exceeded', 'provider_limit')
  if (error.code === 'LSP_STRUCTURE_UNSUPPORTED' || error.code === 'LSP_UNSUPPORTED_OPERATION') return outcome('unsupported', 'capability_missing')
  if (error.code === 'LSP_STRUCTURE_BUSY') return outcome('unavailable', 'parser_busy')
  if (error.code === 'LSP_CODE_INTELLIGENCE_UNAVAILABLE' || error.code === 'LSP_STRUCTURE_UNAVAILABLE' || error.code === 'LSP_UNAVAILABLE') return outcome('unavailable', 'provider_unavailable')
  if (error.code === 'LSP_WORKSPACE_REQUIRED') return outcome('unavailable', 'invalid_path')
  return outcome('unavailable', 'provider_operation_failed')
}

function projectNode(node: StructureNode): { handle: string; kind: string; range: StructureNode['range']; name?: string } {
  return { handle: node.handle, kind: node.kind, range: node.range, ...(node.name ? { name: node.name } : {}) }
}

function trimUtf16(value: string, limit: number): string {
  if (value.length <= limit) return value
  const end = value.charCodeAt(limit - 1) >= 0xd800 && value.charCodeAt(limit - 1) <= 0xdbff ? limit - 1 : limit
  return value.slice(0, end)
}

function validCodeRequest(value: unknown): value is CodeRequestV1 {
  if (!isRecord(value) || typeof value.method !== 'string') return false
  const keys: Record<string, string[]> = {
    capabilities: ['method'], 'snapshot.open': ['method', 'path'], 'snapshot.release': ['method', 'handle'],
    'structure.outline': ['method', 'handle', 'range', 'limit'], 'structure.enclosing': ['method', 'handle', 'position', 'kinds'],
    'structure.query': ['method', 'handle', 'queryId', 'range', 'limit'], 'structure.span': ['method', 'nodeHandle', 'maxChars'],
    'semantic.query': ['method', 'handle', 'kind', 'position', 'limit'],
  }
  const allowed = keys[value.method]
  if (!allowed || Object.keys(value).some(key => !allowed.includes(key))) return false
  const handle = 'handle' in value ? value.handle : 'nodeHandle' in value ? value.nodeHandle : undefined
  if (handle !== undefined && (typeof handle !== 'string' || !handle.length || handle.length > 256)) return false
  if (value.method === 'snapshot.open') return typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096
  if (value.method === 'capabilities' || value.method === 'snapshot.release') return true
  if ('limit' in value && value.limit !== undefined && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 200)) return false
  if ('range' in value && value.range !== undefined && !validRange(value.range)) return false
  if (value.method === 'structure.outline') return value.limit === undefined || value.limit <= 100
  if (value.method === 'structure.enclosing') return validPosition(value.position) && (value.kinds === undefined || Array.isArray(value.kinds) && value.kinds.length <= 30 && value.kinds.every(kind => typeof kind === 'string' && kind.length <= 100))
  if (value.method === 'structure.query') return ['declarations', 'calls', 'imports'].includes(String(value.queryId))
  if (value.method === 'structure.span') return value.maxChars === undefined || Number.isSafeInteger(value.maxChars) && value.maxChars >= 1 && value.maxChars <= 8000
  if (value.method === 'semantic.query') return ['definition', 'references', 'implementation', 'hover', 'diagnostics', 'completion'].includes(String(value.kind)) && (value.kind === 'diagnostics' || validPosition(value.position))
  return false
}

function validRange(value: unknown): value is { start: { line: number; character: number }; end: { line: number; character: number } } {
  if (!isRecord(value) || !validPosition(value.start) || !validPosition(value.end)) return false
  return value.end.line > value.start.line || value.end.line === value.start.line && value.end.character >= value.start.character
}
function validPosition(value: unknown): value is { line: number; character: number } { return isRecord(value) && Number.isSafeInteger(value.line) && Number.isSafeInteger(value.character) && value.line >= 0 && value.character >= 0 }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function identity(value: unknown): unknown { return value && typeof value === 'object' ? (value as Record<symbol, unknown>)[symbols.original] ?? value : value }
function validateBinding(binding: CodeHostBindingV1): void {
  if (!binding || !binding.owner || typeof binding.owner.agentId !== 'string' || typeof binding.owner.sessionId !== 'string' || typeof binding.workspaceRoot !== 'string' || !isAbsolute(binding.workspaceRoot) || !binding.scope || typeof binding.assertCurrent !== 'function' || !binding.context || typeof binding.context.get !== 'function')
    throw new WebstackLspError('LSP_CODE_INTELLIGENCE_UNAVAILABLE', 'invalid trusted code host binding')
}
