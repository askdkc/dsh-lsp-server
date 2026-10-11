/** Side-effect-free V1 protocol shared with protected Lisp adapters. */
export const CODE_INTELLIGENCE_SERVICE = 'codeIntelligence' as const
export const CODE_INTELLIGENCE_VERSION = 1 as const

export type CodeStatus = 'ok' | 'partial' | 'unsupported' | 'unavailable' | 'stale' | 'cancelled' | 'timeout' | 'limit_exceeded'
export interface CodePosition { line: number; character: number }
export interface CodeRange { start: CodePosition; end: CodePosition }
export type CodeSemanticKind = 'definition' | 'references' | 'implementation' | 'hover' | 'diagnostics' | 'completion'
export type CodeQueryId = 'declarations' | 'calls' | 'imports'

export type CodeRequestV1 =
  | { method: 'capabilities' }
  | { method: 'snapshot.open'; path: string }
  | { method: 'snapshot.release'; handle: string }
  | { method: 'structure.outline'; handle: string; range?: CodeRange; limit?: number }
  | { method: 'structure.enclosing'; handle: string; position: CodePosition; kinds?: string[] }
  | { method: 'structure.query'; handle: string; queryId: CodeQueryId; range?: CodeRange; limit?: number }
  | { method: 'structure.span'; nodeHandle: string; maxChars?: number }
  | { method: 'semantic.query'; handle: string; kind: CodeSemanticKind; position?: CodePosition; limit?: number }

export interface CodeCapabilitiesV1 {
  version: 1
  capabilities: Array<'snapshots' | 'structure' | 'semantic'>
  languages: string[]
  queryIds: CodeQueryId[]
  semanticReady: boolean
  sourceKinds: ['disk']
  languageCapabilities: Array<{
    language: string
    structure: boolean
    semantic: CodeSemanticKind[]
    semanticReady: boolean
    reason?: string
  }>
  limits: {
    documentBytes: number
    captureItems: number
    outlineItems: number
    spanChars: number
    responseBytes: number
    files: number
    inputBytes: number
    outputBytes: number
    calls: number
    batchMs: number
    structureMs: number
    semanticMs: number
  }
}

export interface CodeResponseV1 {
  protocol: 'code-intelligence/v1'
  status: CodeStatus
  reason?: string
  sourceKind: 'disk'
  freshness: 'pinned' | 'current' | 'unknown' | 'stale'
  snapshotVersion?: string
  truncated: boolean
  omitted: number
  inputBytes?: number
  data?: unknown
}

/** Authority comes from the host binding, never from code primitive arguments. */
export interface CodeHostBindingV1 {
  owner: { agentId: string; sessionId: string }
  workspaceRoot: string
  scope: object
  context: { get(name: string, strict?: boolean): unknown }
  assertCurrent(): void | Promise<void>
}

export interface CodeLeaseV1 {
  request(input: CodeRequestV1, signal: AbortSignal): Promise<CodeResponseV1>
  dispose(): Promise<void>
}

export interface CodeIntelligenceServiceV1 {
  version: 1
  capabilities: readonly ('snapshots' | 'structure' | 'semantic')[]
  bind(binding: CodeHostBindingV1, signal: AbortSignal): Promise<CodeLeaseV1>
  dispose?(): Promise<void>
}
