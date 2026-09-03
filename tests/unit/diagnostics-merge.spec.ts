import { describe, expect, it } from 'vitest'
import { normalizeDiagnostic } from '../../src/protocol/normalize-diagnostic.js'
import { mergeDiagnostics } from '../../src/merge/diagnostics.js'

describe('diagnostic normalization and merge', () => {
  it('deduplicates identical diagnostics and preserves server provenance', () => {
    const a = normalizeDiagnostic({ uri: 'file:///a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'bad', code: 1 }, 'typescript', 'file:///a.ts')!
    const b = normalizeDiagnostic({ uri: 'file:///a.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'bad', code: 1 }, 'tailwind', 'file:///a.ts')!
    expect(mergeDiagnostics([[a], [b]], { maxDiagnostics: 10, maxResultChars: 1000 }).diagnostics[0]).toMatchObject({ message: 'bad', servers: ['typescript', 'tailwind'] })
  })

  it('drops malformed values and reports truncation', () => {
    expect(normalizeDiagnostic({ message: 'missing range' }, 'typescript', 'file:///a.ts')).toBeUndefined()
    const item = normalizeDiagnostic({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'bad' }, 'typescript', 'file:///a.ts')!
    expect(mergeDiagnostics([[item, { ...item, message: 'other' }]], { maxDiagnostics: 1, maxResultChars: 1000 }).truncated).toBeDefined()
  })
})
