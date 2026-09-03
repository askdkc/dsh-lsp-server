const DEFAULT_PATTERNS = [
  /\bclass\s*=\s*["'][^"']*$/i,
  /\bclassName\s*=\s*["'][^"']*$/i,
  /\bclass:list\s*=\s*["'][^"']*$/i,
  /@apply\s+[\w-]*$/i,
  /\b(?:clsx|cva)\s*\([^)]*["'][^"']*$/i,
]

export function hasTailwindCandidate(source: string, line: number, classRegex: Array<string | [string, string]> = []): boolean {
  const lines = source.split(/\r?\n/)
  const context = lines.slice(Math.max(0, line - 2), Math.min(lines.length, line + 3)).join('\n')
  const configured = classRegex.flatMap((item) => Array.isArray(item) ? item : [item]).map((pattern) => new RegExp(pattern))
  return [...DEFAULT_PATTERNS, ...configured].some((pattern) => pattern.test(context))
}
