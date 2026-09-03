import { describe, expect, it } from 'vitest'
import { normalizeCompletion } from '../../src/protocol/normalize-completion.js'
import { mergeCompletions } from '../../src/merge/completion.js'

describe('completion normalization and merge', () => {
  it('deduplicates by label, insertText and detail in primary-first order', () => {
    const primary = normalizeCompletion([{ label: 'Button', insertText: 'Button', detail: 'component' }], 'typescript')
    const auxiliary = normalizeCompletion([{ label: 'Button', insertText: 'Button', detail: 'component' }, { label: 'px-4' }], 'tailwind')
    expect(mergeCompletions([primary, auxiliary], { maxCompletions: 10, maxResultChars: 1000 }).items.map((item) => item.label)).toEqual(['Button', 'px-4'])
  })

  it('caps output without retaining text edits', () => {
    const items = normalizeCompletion([{ label: 'a' }, { label: 'b' }], 'typescript')
    const result = mergeCompletions([items], { maxCompletions: 1, maxResultChars: 1000 })
    expect(result.items).toHaveLength(1)
    expect(result.truncated?.items).toBe(1)
    expect(result.items[0]).not.toHaveProperty('textEdit')
  })
})
