import type { NormalizedHover } from '../protocol/normalize-hover.js'
import type { LspRange } from '../service.js'

export interface ServerHover extends NormalizedHover {
  server: string
}

export function mergeHover(primary: ServerHover | null | undefined, auxiliary: ServerHover | null | undefined): ServerHover | null {
  if (!primary && !auxiliary) return null
  if (!primary) return auxiliary ? { ...auxiliary } : null
  if (!auxiliary) return { ...primary }
  const contents = [primary.contents, auxiliary.contents].filter((value, index, values) => values.indexOf(value) === index)
  const range = sameRange(primary.range, auxiliary.range) ? primary.range : undefined
  return { server: primary.server, contents: contents.join('\n\n'), ...(range ? { range } : {}) }
}

function sameRange(left: LspRange | undefined, right: LspRange | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
