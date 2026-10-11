import type { LspPosition, LspRange } from '../service.js'

interface Line { start: number; end: number }

/** web-tree-sitter 0.27.1 exposes JS-string indices as UTF-16 code-unit offsets. */
export class Utf16Coordinates {
  private readonly lines: Line[]

  constructor(private readonly text: string) {
    this.lines = []
    let start = 0
    for (let index = 0; index < text.length;) {
      const char = text[index]!
      if (char !== '\r' && char !== '\n') { index++; continue }
      this.lines.push({ start, end: index })
      if (char === '\r' && text[index + 1] === '\n') index++
      index++
      start = index
    }
    this.lines.push({ start, end: text.length })
  }

  positionToIndex(position: LspPosition): number {
    if (!isPosition(position)) throw new RangeError('position must use non-negative zero-based UTF-16 coordinates')
    const line = this.lines[position.line]
    if (!line || position.character > line.end - line.start) throw new RangeError('position is outside document')
    const index = line.start + position.character
    if (isBetweenSurrogatePair(this.text, index)) throw new RangeError('position splits a UTF-16 surrogate pair')
    return index
  }

  indexToPosition(index: number): LspPosition {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.text.length) throw new RangeError('Tree-sitter index is outside document')
    let low = 0, high = this.lines.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.lines[middle]!.start <= index) low = middle + 1
      else high = middle
    }
    const lineNumber = Math.max(0, low - 1)
    const line = this.lines[lineNumber]!
    return { line: lineNumber, character: Math.min(index, line.end) - line.start }
  }

  rangeToIndices(range: LspRange): { startIndex: number; endIndex: number } {
    const startIndex = this.positionToIndex(range.start)
    const endIndex = this.positionToIndex(range.end)
    if (endIndex < startIndex) throw new RangeError('range end precedes range start')
    return { startIndex, endIndex }
  }

  indicesToRange(startIndex: number, endIndex: number): LspRange {
    if (endIndex < startIndex) throw new RangeError('range end precedes range start')
    return { start: this.indexToPosition(startIndex), end: this.indexToPosition(endIndex) }
  }
}

function isPosition(value: unknown): value is LspPosition {
  if (typeof value !== 'object' || value === null) return false
  const position = value as { line?: unknown; character?: unknown }
  return Number.isSafeInteger(position.line) && Number.isSafeInteger(position.character) && (position.line as number) >= 0 && (position.character as number) >= 0
}

function isBetweenSurrogatePair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false
  const previous = text.charCodeAt(index - 1), next = text.charCodeAt(index)
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
}
