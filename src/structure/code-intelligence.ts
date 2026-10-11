import { WebstackLspError } from '../errors.js'
import { DocumentSnapshotStore } from './snapshots.js'
import type { SnapshotRecord } from './snapshots.js'
import { StructureEngine, MAX_CAPTURES, MAX_OUTLINE, MAX_SPAN_CHARS, MAX_STRUCTURE_RESPONSE_BYTES } from './engine.js'
import type { CodeIntelligenceCapabilities, CodeIntelligenceToolServiceV1, SemanticQuery, SemanticResult, SnapshotScope, StructureEnclosingResult, StructureOutlineResult, StructureQueryResult, StructureSpanResult } from './types.js'
import type { CompletionResult, DiagnosticsResult, NavigationResult } from '../service.js'

export interface CodeIntelligenceServiceOptions {
  snapshots: DocumentSnapshotStore
  semanticQuery(scope: SnapshotScope, snapshot: SnapshotRecord, request: SemanticQuery, signal: AbortSignal): Promise<CompletionResult | DiagnosticsResult | NavigationResult>
}

export class CodeIntelligenceRuntime implements CodeIntelligenceToolServiceV1 {
  readonly version = 1 as const
  readonly snapshot: CodeIntelligenceToolServiceV1['snapshot']
  readonly structure: CodeIntelligenceToolServiceV1['structure']
  readonly semantic: CodeIntelligenceToolServiceV1['semantic']
  private readonly store: DocumentSnapshotStore
  private readonly engine: StructureEngine

  constructor(options: CodeIntelligenceServiceOptions) {
    this.store = options.snapshots
    this.engine = new StructureEngine()

    this.snapshot = {
      open: async (scope, filePath, signal) => {
        const record = await this.store.open(scope, filePath, signal)
        try {
          const parser = await this.engine.inspect(record, signal)
          await this.store.current(scope, record.descriptor.handle, signal)
          return { status: 'ok', ...record.descriptor, parserAvailable: parser.available, parseErrors: parser.parseErrors }
        } catch (error) {
          this.store.release(scope, record.descriptor.handle)
          this.engine.releaseSnapshot(record.descriptor.handle)
          throw error
        }
      },
      release: async (scope, handle) => {
        const released = this.store.release(scope, handle)
        if (released) this.engine.releaseSnapshot(handle)
        return { released }
      },
    }

    this.structure = {
      outline: (scope, handle, request, signal) => this.withSnapshot(scope, handle, signal, record => this.engine.outline(record, scope, request, signal)) as Promise<StructureOutlineResult>,
      enclosing: (scope, handle, position, request, signal) => this.withSnapshot(scope, handle, signal, record => this.engine.enclosing(record, scope, position, request?.kinds, signal)) as Promise<StructureEnclosingResult>,
      query: (scope, handle, queryId, request, signal) => this.withSnapshot(scope, handle, signal, record => this.engine.query(record, scope, queryId, request, signal)) as Promise<StructureQueryResult>,
      span: (scope, nodeHandle, maxChars, signal) => this.span(scope, nodeHandle, maxChars, signal),
    }

    this.semantic = {
      query: async (scope, handle, request, signal) => {
        validateSemanticQuery(request)
        return this.withSnapshot(scope, handle, signal, async record => {
          const raw = await options.semanticQuery(scope, record, request, signal ?? new AbortController().signal)
          await this.store.current(scope, handle, signal)
          const bounded = limitSemanticResult(raw, request.maxResults ?? 200)
          const truncated = 'truncated' in bounded && Boolean(bounded.truncated)
          const status = semanticIsPartial(bounded) || truncated ? 'partial' : 'ok'
          const value: SemanticResult = { status, operation: request.operation, result: bounded, ...(truncated ? { truncated: true, omitted: 'omitted' in bounded && typeof bounded.omitted === 'number' ? bounded.omitted : 0 } : {}) }
          if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_STRUCTURE_RESPONSE_BYTES)
            throw new WebstackLspError('LSP_STRUCTURE_LIMIT', 'semantic result exceeds the response byte limit')
          return value
        }) as Promise<SemanticResult>
      },
    }
  }

  capabilities(): CodeIntelligenceCapabilities {
    const parsers = this.engine.capabilities().map(parser => ({
      ...parser,
      runtimeAbi: { minimum: 13, current: 15 },
    }))
    return {
      version: 1,
      parsers,
      sourceKind: 'disk',
      overlay: 'unavailable',
      limits: {
        maxDocumentBytes: Math.min(this.store.documentByteLimit, 2 * 1024 * 1024),
        maxCaptures: MAX_CAPTURES,
        maxOutline: MAX_OUTLINE,
        maxSpanChars: MAX_SPAN_CHARS,
        maxResponseBytes: MAX_STRUCTURE_RESPONSE_BYTES,
      },
      incrementalParsing: true,
    }
  }

  async releaseOwner(scope: SnapshotScope): Promise<number> {
    this.engine.releaseOwner(scope)
    return this.store.releaseOwner(scope)
  }

  async dispose(): Promise<void> { this.store.clear(); await this.engine.dispose() }

  private async span(scope: SnapshotScope, nodeHandle: string, maxChars = MAX_SPAN_CHARS, signal?: AbortSignal): Promise<StructureSpanResult> {
    const snapshotHandle = this.engine.snapshotForNode(scope, nodeHandle)
    return this.withSnapshot(scope, snapshotHandle, signal, record => this.engine.span(record, scope, nodeHandle, maxChars)) as Promise<StructureSpanResult>
  }

  private async withSnapshot<T>(scope: SnapshotScope, handle: string, signal: AbortSignal | undefined, execute: (record: Awaited<ReturnType<DocumentSnapshotStore['current']>>) => Promise<T>): Promise<T> {
    let record: Awaited<ReturnType<DocumentSnapshotStore['current']>>
    try { record = await this.store.current(scope, handle, signal) }
    catch (error) {
      if (error instanceof WebstackLspError && error.code === 'LSP_STALE_SNAPSHOT') this.engine.releaseSnapshotForOwner(scope, handle)
      throw error
    }
    try {
      const result = await execute(record)
      await this.store.current(scope, handle, signal)
      return result
    } catch (error) {
      if (error instanceof WebstackLspError && error.code === 'LSP_STALE_SNAPSHOT') this.engine.releaseSnapshotForOwner(scope, handle)
      throw error
    }
  }

}

export function createCodeIntelligenceToolServiceV1(options: CodeIntelligenceServiceOptions): CodeIntelligenceToolServiceV1 {
  return new CodeIntelligenceRuntime(options)
}

function validateSemanticQuery(request: SemanticQuery): void {
  if (!request || !['definition', 'references', 'implementation', 'hover', 'diagnostics', 'completion'].includes(request.operation))
    throw new WebstackLspError('LSP_UNSUPPORTED_OPERATION', 'semantic operation is not supported')
  if (request.operation !== 'diagnostics' && !request.position)
    throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'semantic position is required for this operation')
  if (request.position && (!Number.isSafeInteger(request.position.line) || !Number.isSafeInteger(request.position.character) || request.position.line < 0 || request.position.character < 0))
    throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'semantic position must be a zero-based UTF-16 position')
  if (request.servers && (!Array.isArray(request.servers) || request.servers.length > 6 || request.servers.some(server => typeof server !== 'string' || server.length > 64)))
    throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'semantic server filter is invalid')
  if (request.maxResults !== undefined && (!Number.isSafeInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 200))
    throw new WebstackLspError('LSP_STRUCTURE_LIMIT', 'maxResults must be between 1 and 200')
}

function semanticIsPartial(result: CompletionResult | DiagnosticsResult | NavigationResult): boolean {
  if ('diagnostics' in result) return Boolean(result.omittedServers?.length || result.truncated)
  if ('items' in result) return Boolean(result.truncated)
  if (result.kind === 'locations') return Boolean(result.truncated)
  return false
}

function limitSemanticResult(result: CompletionResult | DiagnosticsResult | NavigationResult, limit: number): CompletionResult | DiagnosticsResult | NavigationResult {
  if ('items' in result) {
    if (result.items.length <= limit) return result
    return { ...result, items: result.items.slice(0, limit), truncated: { items: result.items.length - limit, characters: 0 } }
  }
  if ('diagnostics' in result) {
    if (result.diagnostics.length <= limit) return result
    return { ...result, diagnostics: result.diagnostics.slice(0, limit), truncated: { diagnostics: result.diagnostics.length - limit, characters: 0 } }
  }
  if (result.kind === 'locations' && result.locations.length > limit)
    return { ...result, locations: result.locations.slice(0, limit), truncated: true, omitted: result.locations.length - limit }
  return result
}
