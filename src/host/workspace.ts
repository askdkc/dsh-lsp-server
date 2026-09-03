import { resolve, relative, isAbsolute } from 'node:path'

export interface WorkspaceFileSystem {
  realpath(path: string): Promise<string>
  stat(path: string): Promise<{ isFile(): boolean }>
  readFile(path: string): Promise<Uint8Array | string>
}

export interface CanonicalWorkspace {
  root: string
}

export async function canonicalizeWorkspace(fs: WorkspaceFileSystem, root: string): Promise<CanonicalWorkspace> {
  if (!root || !isAbsolute(root)) throw new Error('workspace root must be an absolute path')
  const canonicalRoot = await fs.realpath(root)
  const stat = await fs.stat(canonicalRoot)
  if (!stat.isFile() && canonicalRoot === root) return { root: canonicalRoot }
  return { root: canonicalRoot }
}

export async function resolveWorkspaceSource(fs: WorkspaceFileSystem, workspace: CanonicalWorkspace, filePath: string, maxDocumentBytes: number): Promise<{ path: string; text: string }> {
  if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes <= 0) throw new Error('maxDocumentBytes must be positive')
  const candidate = resolve(workspace.root, filePath)
  const canonicalPath = await fs.realpath(candidate)
  if (!isContained(workspace.root, canonicalPath)) throw new Error('source is outside workspace')
  const stat = await fs.stat(canonicalPath)
  if (!stat.isFile()) throw new Error('source is not a regular file')
  const content = await fs.readFile(canonicalPath)
  const bytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength
  if (bytes > maxDocumentBytes) throw new Error('source exceeds document limit')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(typeof content === 'string' ? Buffer.from(content) : content)
  } catch {
    throw new Error('source is not valid UTF-8')
  }
  return { path: canonicalPath, text }
}

export function isContained(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (child !== '..' && !child.startsWith(`..${requireSeparator(root)}`) && !isAbsolute(child))
}

function requireSeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/'
}
