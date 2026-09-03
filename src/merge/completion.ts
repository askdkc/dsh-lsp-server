import type { CompletionResult, NormalizedCompletionItem } from '../service.js'

export interface CompletionMergeLimits { maxCompletions: number; maxResultChars: number }

export function mergeCompletions(groups: ReadonlyArray<ReadonlyArray<NormalizedCompletionItem>>, limits: CompletionMergeLimits): CompletionResult {
  const seen = new Set<string>()
  const items: NormalizedCompletionItem[] = []
  let characters = 0
  let omitted = 0
  for (const group of groups) for (const item of group) {
    const key = `${item.label}|${item.insertText ?? ''}|${item.detail ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const size = JSON.stringify(item).length
    if (items.length >= limits.maxCompletions || characters + size > limits.maxResultChars) { omitted += 1; continue }
    characters += size
    items.push({ ...item })
  }
  return omitted === 0 ? { items } : { items, truncated: { items: omitted, characters: Math.max(0, seen.size - items.length) } }
}
