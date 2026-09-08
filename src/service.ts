import { WebstackLspError } from './errors.js'
import type { ResolvedConfig } from './config.js'

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }

export interface DiagnosticsRequest { workspaceRoot: string; filePath: string; severity?: 'all' | 'error' | 'warning'; servers?: string[] }
export interface CompletionRequest { workspaceRoot: string; filePath: string; position: LspPosition; triggerKind?: 1 | 2 | 3; triggerCharacter?: string }

export interface NormalizedDiagnostic {
  server: string
  uri: string
  range: LspRange
  severity?: 1 | 2 | 3 | 4
  code?: string | number
  source?: string
  message: string
  tags?: number[]
  servers?: string[]
}
export interface NormalizedCompletionItem { server: string; label: string; kind?: number; detail?: string; documentation?: string; sortText?: string; filterText?: string; insertText?: string; insertTextFormat?: number; deprecated?: boolean }
export interface DiagnosticsResult { diagnostics: NormalizedDiagnostic[]; omittedServers?: string[]; truncated?: { diagnostics: number; characters: number } }
export interface CompletionResult { items: NormalizedCompletionItem[]; truncated?: { items: number; characters: number } }

export interface WebstackLspStatus {
  providerId: string
  servers: Array<{ id: import('./config.js').ServerId; enabled: boolean; available: boolean; source: 'bundled' | 'path'; command?: string; version?: string; lastError?: string; liveWorkspaces: number; restarts: number }>
}

export interface WebstackLspService {
  status(): Promise<WebstackLspStatus>
  diagnostics(request: DiagnosticsRequest, signal?: AbortSignal): Promise<DiagnosticsResult>
  completion(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult>
}

export interface ExtendedRuntime extends WebstackLspService {}

export function createWebstackLspService(runtime: ExtendedRuntime, config: Pick<ResolvedConfig, 'limits'> = { limits: { maxDocumentBytes: 1_048_576, maxMessageBytes: 8_388_608, maxStderrBytes: 65_536 } }): WebstackLspService {
  return {
    status: () => runtime.status(),
    diagnostics: (request, signal) => runtime.diagnostics(validateDiagnosticsRequest(request), signal),
    completion: (request, signal) => runtime.completion(validateCompletionRequest(request), signal),
  }
}

function validateDiagnosticsRequest(request: DiagnosticsRequest): DiagnosticsRequest {
  if (!isRequest(request) || typeof request.workspaceRoot !== 'string' || request.workspaceRoot.length === 0 || typeof request.filePath !== 'string' || request.filePath.length === 0) throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'workspaceRoot and filePath are required')
  return { ...request, ...(request.servers ? { servers: [...request.servers] } : {}) }
}

function validateCompletionRequest(request: CompletionRequest): CompletionRequest {
  if (!isRequest(request) || typeof request.workspaceRoot !== 'string' || request.workspaceRoot.length === 0 || typeof request.filePath !== 'string' || request.filePath.length === 0 || !isPosition(request.position)) throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'workspaceRoot, filePath and position are required')
  return { ...request, position: { ...request.position } }
}

function isPosition(value: unknown): value is LspPosition { return typeof value === 'object' && value !== null && Number.isInteger((value as { line?: unknown }).line) && Number.isInteger((value as { character?: unknown }).character) && (value as LspPosition).line >= 0 && (value as LspPosition).character >= 0 }
function isRequest(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export function createUnavailableService(providerId = 'webstack'): WebstackLspService {
  return { status: async () => ({ providerId, servers: [] }), diagnostics: async () => Promise.reject(new WebstackLspError('LSP_UNAVAILABLE', 'webstack runtime is unavailable')), completion: async () => Promise.reject(new WebstackLspError('LSP_UNAVAILABLE', 'webstack runtime is unavailable')) }
}
