import type { LspRange, NormalizedDiagnostic } from '../service.js'

export function normalizeDiagnostic(value: unknown, server: string, fallbackUri: string): NormalizedDiagnostic | undefined {
  if (!isRecord(value) || !isRange(value.range) || typeof value.message !== 'string') return undefined
  const uri = typeof value.uri === 'string' ? value.uri : fallbackUri
  const severity = typeof value.severity === 'number' && value.severity >= 1 && value.severity <= 4 ? value.severity as 1 | 2 | 3 | 4 : undefined
  const code = typeof value.code === 'string' || typeof value.code === 'number' ? value.code : undefined
  return { server, uri, range: value.range, message: value.message, ...(severity === undefined ? {} : { severity }), ...(code === undefined ? {} : { code }), ...(typeof value.source === 'string' ? { source: value.source } : {}) }
}

export function normalizeDiagnostics(value: unknown, server: string, fallbackUri: string): NormalizedDiagnostic[] {
  const values = Array.isArray(value) ? value : []
  return values.map((item) => normalizeDiagnostic(item, server, fallbackUri)).filter((item): item is NormalizedDiagnostic => item !== undefined)
}

function isRange(value: unknown): value is LspRange {
  return isRecord(value) && isPosition(value.start) && isPosition(value.end)
}

function isPosition(value: unknown): boolean {
  return isRecord(value) && Number.isInteger(value.line) && Number.isInteger(value.character) && value.line >= 0 && value.character >= 0
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
