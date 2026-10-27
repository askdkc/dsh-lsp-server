import type { CompletionResult, DiagnosticsResult, LspPosition, LspRange, NavigationResult } from '../service.js'

export type StructureLanguage =
  | 'javascript' | 'typescript' | 'tsx' | 'php' | 'svelte'
  | 'bash' | 'c' | 'cpp' | 'c_sharp' | 'css' | 'go' | 'haskell' | 'html'
  | 'java' | 'json' | 'julia' | 'ocaml' | 'ocaml_interface' | 'python'
  | 'ql_dbscheme' | 'ruby' | 'rust' | 'scala'
export type CodeIntelligenceStatus = 'ok' | 'partial' | 'unsupported' | 'unavailable' | 'stale' | 'cancelled' | 'timeout' | 'limit_exceeded'
export type SourceKind = 'disk' | 'overlay'

/** Values are created by the trusted host adapter, never from model arguments. */
export interface SnapshotScope {
  ownerId: string
  sessionId: string
  workspaceRoot: string
}

export interface SnapshotDescriptor {
  handle: string
  version: number
  filePath: string
  language: StructureLanguage | null
  sourceKind: SourceKind
  contentHash: string
  sourceBytes: number
}

export interface SnapshotOpenResult extends SnapshotDescriptor {
  status: 'ok'
  parserAvailable: boolean
  parseErrors: boolean
}

export interface SnapshotReleaseResult { released: boolean }

export interface StructureNode {
  handle: string
  kind: string
  range: LspRange
  name?: string
  childCount?: number
}

export interface StructureErrorSummary { hasError: boolean; errorNodes: number; missingNodes: number; truncated: boolean }
export interface StructureOutlineResult {
  status: 'ok' | 'partial' | 'unsupported'
  handle: string
  version: number
  declarations: StructureNode[]
  truncated: boolean
  processed: number
  errors: StructureErrorSummary
}

export interface StructureEnclosingResult {
  status: 'ok' | 'partial' | 'unsupported'
  handle: string
  version: number
  node?: StructureNode
  ancestors: StructureNode[]
  errors?: StructureErrorSummary
}

export interface StructureCapture {
  capture: string
  kind: string
  range: LspRange
  nodeHandle: string
  name?: string
}

export interface StructureQueryResult {
  status: 'ok' | 'partial'
  handle: string
  version: number
  queryId: string
  captures: StructureCapture[]
  truncated: boolean
  processed: number
  errors: StructureErrorSummary
}

export interface StructureSpanResult { status: 'ok' | 'partial'; text: string; truncated: boolean; range: LspRange }

export type SemanticOperation = 'definition' | 'references' | 'implementation' | 'hover' | 'diagnostics' | 'completion'
export interface SemanticQuery {
  operation: SemanticOperation
  position?: LspPosition
  severity?: 'all' | 'error' | 'warning'
  servers?: string[]
  maxResults?: number
}
export interface SemanticResult {
  status: 'ok' | 'partial' | 'unsupported' | 'unavailable' | 'stale' | 'cancelled' | 'timeout' | 'limit_exceeded'
  operation: SemanticOperation
  result?: unknown
  truncated?: boolean
  omitted?: number
}

export interface CodeIntelligenceCapabilities {
  version: 1
  parsers: Array<{
    language: StructureLanguage
    extensions: string[]
    available: boolean
    abiVersion: number | null
    runtimeAbi: { minimum: number; current: number }
    lastError?: string
  }>
  sourceKind: 'disk'
  overlay: 'unavailable'
  limits: {
    maxDocumentBytes: number
    maxCaptures: number
    maxOutline: number
    maxSpanChars: number
    maxResponseBytes: number
  }
  incrementalParsing: boolean
}

export interface CodeIntelligenceToolServiceV1 {
  readonly version: 1
  snapshot: {
    open(scope: SnapshotScope, filePath: string, signal?: AbortSignal): Promise<SnapshotOpenResult>
    release(scope: SnapshotScope, handle: string): Promise<SnapshotReleaseResult>
  }
  structure: {
    outline(scope: SnapshotScope, handle: string, options?: { range?: LspRange; limit?: number }, signal?: AbortSignal): Promise<StructureOutlineResult>
    enclosing(scope: SnapshotScope, handle: string, position: LspPosition, options?: { kinds?: string[] }, signal?: AbortSignal): Promise<StructureEnclosingResult>
    query(scope: SnapshotScope, handle: string, queryId: string, options?: { range?: LspRange; limit?: number }, signal?: AbortSignal): Promise<StructureQueryResult>
    span(scope: SnapshotScope, nodeHandle: string, maxChars?: number, signal?: AbortSignal): Promise<StructureSpanResult>
  }
  semantic: {
    query(scope: SnapshotScope, handle: string, request: SemanticQuery, signal?: AbortSignal): Promise<SemanticResult>
  }
  capabilities(): CodeIntelligenceCapabilities
  releaseOwner?(scope: SnapshotScope): Promise<number>
  dispose?(): Promise<void>
}

export type SnapshotSemanticCallback = (
  scope: SnapshotScope,
  snapshot: SnapshotDescriptor,
  request: SemanticQuery,
  signal: AbortSignal,
) => Promise<CompletionResult | DiagnosticsResult | NavigationResult>
