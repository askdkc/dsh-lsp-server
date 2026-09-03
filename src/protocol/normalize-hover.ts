import type { LspRange } from '../service.js'

export interface NormalizedHover {
  contents: string
  range?: LspRange
}

export function normalizeHover(value: unknown): NormalizedHover | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { contents?: unknown; range?: unknown }
  const contents = normalizeContents(record.contents)
  if (contents === undefined) return undefined
  return { contents, ...(isRange(record.range) ? { range: record.range } : {}) }
}

function normalizeContents(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value.map((item) => typeof item === 'string' ? item : isRecord(item) && typeof item.value === 'string' ? item.value : undefined)
    return parts.every((item): item is string => item !== undefined) ? parts.join('\n') : undefined
  }
  if (isRecord(value) && typeof value.value === 'string') return value.value
  return undefined
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
