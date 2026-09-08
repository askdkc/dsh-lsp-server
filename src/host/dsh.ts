import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { WebstackLspError } from '../errors.js'
import { throwIfAborted } from '../runtime/cancellation.js'

export type HostFileSystem = Pick<FileSystem, 'resolve' | 'stat' | 'processPath' | 'fileUrl' | 'contains' | 'streamText'>
export interface HostSource { workspace: string; workspaceUri: string; key: string; uri: string; text: string }

export async function readSource(fs: HostFileSystem, workspaceRoot: string, filePath: string, maxBytes: number, signal?: AbortSignal): Promise<HostSource> {
  if (!workspaceRoot?.trim() || !filePath?.trim()) throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'workspaceRoot and filePath are required')
  throwIfAborted(signal)
  const options = signal ? { signal } : {}
  const root = await fs.resolve(workspaceRoot, options)
  if ((await fs.stat(root, signal))?.type !== 'directory') throw new Error('workspace root is not a directory')
  const workspace = fs.processPath(root)
  const target = await fs.resolve(filePath, { cwd: workspace, ...options })
  if (!fs.contains(root, target)) throw new Error('source is outside workspace')
  if ((await fs.stat(target, signal))?.type !== 'file') throw new Error('source is not a regular file')
  let text = '', bytes = 0
  for await (const chunk of await fs.streamText(target, signal)) {
    throwIfAborted(signal)
    bytes += Buffer.byteLength(chunk)
    if (bytes > maxBytes) throw new Error('source exceeds document limit')
    text += chunk
  }
  throwIfAborted(signal)
  return { workspace, workspaceUri: fs.fileUrl(root), key: root.targetKey, uri: fs.fileUrl(target), text }
}
