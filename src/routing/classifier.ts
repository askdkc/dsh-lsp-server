export type FileKind = 'blade' | 'php' | 'typescript' | 'typescriptreact' | 'javascript' | 'javascriptreact' | 'svelte' | 'html' | 'css'

export interface ClassifiedFile {
  path: string
  basename: string
  suffix: string
  kind: FileKind
}

const CLASSIFIERS: ReadonlyArray<{ suffix: string; kind: FileKind }> = [
  { suffix: '.blade.php', kind: 'blade' },
  { suffix: '.typescriptreact', kind: 'typescriptreact' },
  { suffix: '.javascriptreact', kind: 'javascriptreact' },
  { suffix: '.tsx', kind: 'typescriptreact' },
  { suffix: '.jsx', kind: 'javascriptreact' },
  { suffix: '.mts', kind: 'typescript' },
  { suffix: '.cts', kind: 'typescript' },
  { suffix: '.mjs', kind: 'javascript' },
  { suffix: '.cjs', kind: 'javascript' },
  { suffix: '.svelte', kind: 'svelte' },
  { suffix: '.html', kind: 'html' },
  { suffix: '.htm', kind: 'html' },
  { suffix: '.php', kind: 'php' },
  { suffix: '.ts', kind: 'typescript' },
  { suffix: '.js', kind: 'javascript' },
  { suffix: '.css', kind: 'css' },
  { suffix: '.pcss', kind: 'css' },
]

export function classifyFile(filePath: string, bladeSuffixes: string[] = ['.blade.php']): ClassifiedFile | undefined {
  const normalizedPath = filePath.replaceAll('\\', '/')
  const basename = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1).toLowerCase()
  if (!basename || basename === '.' || basename === '..' || basename.startsWith('.')) return undefined
  const customBlade = bladeSuffixes.map((suffix) => suffix.toLowerCase()).sort((left, right) => right.length - left.length)
  const classifiers = [...customBlade.map((suffix) => ({ suffix, kind: 'blade' as const })), ...CLASSIFIERS.filter((item) => !customBlade.includes(item.suffix))]
  const match = classifiers.find((item) => basename.endsWith(item.suffix))
  if (!match) return undefined
  return { path: normalizedPath, basename, suffix: match.suffix, kind: match.kind }
}
