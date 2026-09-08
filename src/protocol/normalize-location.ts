import type { LspPosition, LspRange } from '../service.js'

export interface NormalizedLocation {
  uri: string
  range: LspRange
}

export function normalizeLocation(value: unknown): NormalizedLocation | undefined {
  if (isRecord(value) && typeof value.targetUri === 'string' && isRange(value.targetSelectionRange)) return { uri: value.targetUri, range: value.targetSelectionRange }
  if (!isRecord(value) || typeof value.uri !== 'string' || !isRange(value.range)) return undefined
  return { uri: value.uri, range: value.range }
}

export function normalizeLocations(value: unknown): NormalizedLocation[] {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  return values.map(normalizeLocation).filter((location): location is NormalizedLocation => location !== undefined)
}

function isRange(value: unknown): value is LspRange {
  return isRecord(value) && isPosition(value.start) && isPosition(value.end)
}

function isPosition(value: unknown): value is LspPosition {
  return isRecord(value) && Number.isInteger(value.line) && Number.isInteger(value.character) && value.line >= 0 && value.character >= 0
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
