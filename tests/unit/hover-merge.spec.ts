import { describe, expect, it } from 'vitest'
import { mergeHover, type ServerHover } from '../../src/merge/hover.js'

const primary: ServerHover = { server: 'typescript', contents: '`const x: string`', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }
const auxiliary: ServerHover = { server: 'tailwind', contents: '.px-4 applies 1rem', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }

describe('mergeHover', () => {
  it('merges primary first and preserves an equal range', () => {
    expect(mergeHover(primary, auxiliary)).toEqual({ server: 'typescript', contents: '`const x: string`\n\n.px-4 applies 1rem', range: primary.range })
  })

  it('returns either side and omits a conflicting range', () => {
    expect(mergeHover(null, auxiliary)).toEqual(auxiliary)
    expect(mergeHover(primary, { ...auxiliary, contents: primary.contents, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } } })).toEqual({ server: 'typescript', contents: primary.contents })
  })
})
