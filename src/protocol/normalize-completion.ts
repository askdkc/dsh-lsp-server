import type { NormalizedCompletionItem } from '../service.js'

export function normalizeCompletionItem(value: unknown, server: string): NormalizedCompletionItem | undefined {
  if (!isRecord(value) || typeof value.label !== 'string' || value.label.length === 0) return undefined
  return {
    server,
    label: value.label,
    ...(typeof value.kind === 'number' ? { kind: value.kind } : {}),
    ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
    ...(typeof value.documentation === 'string' ? { documentation: value.documentation } : {}),
    ...(typeof value.sortText === 'string' ? { sortText: value.sortText } : {}),
    ...(typeof value.filterText === 'string' ? { filterText: value.filterText } : {}),
    ...(typeof value.insertText === 'string' ? { insertText: value.insertText } : {}),
    ...(typeof value.deprecated === 'boolean' ? { deprecated: value.deprecated } : {}),
  }
}

export function normalizeCompletion(value: unknown, server: string): NormalizedCompletionItem[] {
  const items = isRecord(value) && Array.isArray(value.items) ? value.items : Array.isArray(value) ? value : []
  return items.map((item) => normalizeCompletionItem(item, server)).filter((item): item is NormalizedCompletionItem => item !== undefined)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
