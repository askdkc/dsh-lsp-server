import { describe, expect, it } from 'vitest'
import { Utf16Coordinates } from '../../src/structure/coordinates.js'

describe('UTF-16 coordinate conversion', () => {
  it('round-trips CRLF, Japanese, combining marks, emoji, blank lines and EOF', () => {
    const text = 'A\r\n日本語 e\u0301 😀\n\nz'
    const coordinates = new Utf16Coordinates(text)
    const position = { line: 1, character: 9 }
    const index = coordinates.positionToIndex(position)
    expect(index).toBe(12)
    expect(coordinates.indexToPosition(index)).toEqual(position)
    expect(coordinates.indexToPosition(13)).toEqual({ line: 2, character: 0 })
    expect(coordinates.indexToPosition(text.length)).toEqual({ line: 3, character: 1 })
  })

  it('rejects invalid lines, characters and positions between surrogate halves', () => {
    const coordinates = new Utf16Coordinates('x 😀\n')
    expect(coordinates.positionToIndex({ line: 1, character: 0 })).toBe(5)
    expect(() => coordinates.positionToIndex({ line: 0, character: 99 })).toThrow(/outside document/)
    expect(() => coordinates.positionToIndex({ line: 0, character: 3 })).toThrow(/surrogate pair/)
    expect(() => coordinates.positionToIndex({ line: -1, character: 0 })).toThrow(/zero-based UTF-16/)
  })

  it('preserves half-open ranges and rejects reversed endpoints', () => {
    const coordinates = new Utf16Coordinates('日本\n')
    const range = { start: { line: 0, character: 1 }, end: { line: 1, character: 0 } }
    const indices = coordinates.rangeToIndices(range)
    expect(indices).toEqual({ startIndex: 1, endIndex: 3 })
    expect(coordinates.indicesToRange(indices.startIndex, indices.endIndex)).toEqual(range)
    expect(() => coordinates.rangeToIndices({ start: range.end, end: range.start })).toThrow(/precedes/)
  })
})
