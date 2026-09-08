import type { DiagnosticsResult, NormalizedDiagnostic } from '../service.js'

export interface DiagnosticMergeLimits { maxDiagnostics: number; maxResultChars: number }

export function mergeDiagnostics(groups: ReadonlyArray<ReadonlyArray<NormalizedDiagnostic>>, limits: DiagnosticMergeLimits): DiagnosticsResult {
  const byKey = new Map<string, NormalizedDiagnostic & { servers: string[] }>()
  for (const group of groups) for (const item of group) {
    const key = `${item.uri}|${item.range.start.line}:${item.range.start.character}-${item.range.end.line}:${item.range.end.character}|${item.message}|${item.code ?? ''}`
    const existing = byKey.get(key)
    if (existing) { if (!existing.servers.includes(item.server)) existing.servers.push(item.server) }
    else byKey.set(key, { ...item, servers: [item.server] })
  }
  const sorted = [...byKey.values()].sort(compareDiagnostics)
  const diagnostics: NormalizedDiagnostic[] = []
  let characters = 0
  let omitted = 0
  let omittedCharacters = 0
  for (const item of sorted) {
    const size = JSON.stringify(item).length
    if (diagnostics.length >= limits.maxDiagnostics || characters + size > limits.maxResultChars) { omitted += 1; omittedCharacters += size; continue }
    characters += size
    const { servers, ...publicItem } = item
    diagnostics.push(servers.length === 1 ? publicItem : { ...publicItem, servers })
  }
  return omitted === 0 ? { diagnostics } : { diagnostics, truncated: { diagnostics: omitted, characters: omittedCharacters } }
}

function compareDiagnostics(left: NormalizedDiagnostic, right: NormalizedDiagnostic): number {
  const severity = (left.severity ?? 4) - (right.severity ?? 4)
  if (severity) return severity
  return left.uri.localeCompare(right.uri) || left.range.start.line - right.range.start.line || left.range.start.character - right.range.start.character || left.message.localeCompare(right.message)
}
