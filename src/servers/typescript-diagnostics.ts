import { WebstackLspError } from '../errors.js'
import type { JsonRpcConnection } from '../runtime/connection.js'
import type { LspPosition } from '../service.js'

const command = 'typescript.tsserverRequest'
const diagnosticCommands = ['syntacticDiagnosticsSync', 'semanticDiagnosticsSync', 'suggestionDiagnosticsSync'] as const
const severities = { error: 1, warning: 2, message: 3, suggestion: 4 } as const

export function supportsTypeScriptDiagnostics(capabilities: Record<string, unknown>): boolean {
  const provider = capabilities.executeCommandProvider
  return isRecord(provider) && Array.isArray(provider.commands) && provider.commands.includes(command)
}

// Push diagnostics can publish syntax results before semantic checking finishes.
// Request each read-only diagnostic pass and use its correlated response instead.
export async function requestTypeScriptDiagnostics(connection: JsonRpcConnection, uri: string, signal: AbortSignal): Promise<unknown[]> {
  const diagnostics: unknown[] = []
  for (const diagnosticCommand of diagnosticCommands) {
    const response = await connection.request('workspace/executeCommand', {
      command,
      arguments: [diagnosticCommand, { file: uri }, { executionTarget: 0, expectsResult: true }],
    }, signal)
    if (!isRecord(response) || response.type !== 'response' || response.success !== true || !Array.isArray(response.body)) throw malformedResponse()
    for (const item of response.body) diagnostics.push(toDiagnostic(item))
  }
  return diagnostics
}

function toDiagnostic(value: unknown): unknown {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.category !== 'string' || !Object.hasOwn(severities, value.category) || !Number.isSafeInteger(value.code)) throw malformedResponse()
  return {
    range: { start: toPosition(value.start), end: toPosition(value.end) },
    message: value.text,
    severity: severities[value.category as keyof typeof severities],
    code: value.code,
    source: typeof value.source === 'string' ? value.source : 'ts',
  }
}

function toPosition(value: unknown): LspPosition {
  if (!isRecord(value) || typeof value.line !== 'number' || typeof value.offset !== 'number' || !Number.isSafeInteger(value.line) || !Number.isSafeInteger(value.offset) || value.line < 1 || value.offset < 1) throw malformedResponse()
  return { line: value.line - 1, character: value.offset - 1 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function malformedResponse(): WebstackLspError {
  return new WebstackLspError('LSP_MALFORMED_RESPONSE', 'TypeScript server returned an invalid diagnostic response')
}
