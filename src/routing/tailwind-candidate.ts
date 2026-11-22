const DEFAULT_PATTERNS = [
  /\bclass\s*=\s*["'][^"']*$/i,
  /\bclassName\s*=\s*["'][^"']*$/i,
  /\bclass:list\s*=\s*["'][^"']*$/i,
  /@apply\s+[\w-]*$/i,
  /\b(?:clsx|cva)\s*\([^)]*["'][^"']*$/i,
]

export function hasTailwindCandidate(source: string, line: number, classRegex: Array<string | [string, string]> = [], character?: number, classAttributes: string[] = ['class', 'className', 'class:list']): boolean {
  const lines = source.split(/\r?\n/)
  const context = [...lines.slice(Math.max(0, line - 2), line), (lines[line] ?? '').slice(0, character)].join('\n')
  if (classAttributes.some(attribute => {
    const index = context.lastIndexOf(attribute + '=')
    return index >= 0 && /^[\"'][^\"']*$/.test(context.slice(index + attribute.length + 1).trimStart())
  })) return true
  const configured = classRegex.flatMap((item) => Array.isArray(item) ? item : [item]).map((pattern) => new RegExp(pattern))
  return [...DEFAULT_PATTERNS, ...configured].some((pattern) => pattern.test(context))
}

// Diagnostics cover the whole script, including class strings that are already closed.
export function hasScriptClassContext(source: string, attributes: string[], classRegex: Array<string | [string, string]>): boolean {
  if (/\b(?:clsx|cva)\s*\(|@apply\s/.test(source)) return true
  for (const match of source.matchAll(/(?<![\w:-])([\w:-]+)\s*=\s*["'`]/g)) {
    if (attributes.includes(match[1]!)) return true
  }
  return classRegex.some(entry => new RegExp(typeof entry === 'string' ? entry : entry[0]).test(source))
}
