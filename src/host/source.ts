import type { CanonicalWorkspace, WorkspaceFileSystem } from './workspace.js'
import { resolveWorkspaceSource } from './workspace.js'

export interface SourceReader {
  read(workspace: CanonicalWorkspace, filePath: string, maxDocumentBytes: number): Promise<{ path: string; text: string }>
}

export function createSourceReader(fs: WorkspaceFileSystem): SourceReader {
  return { read: (workspace, filePath, maxDocumentBytes) => resolveWorkspaceSource(fs, workspace, filePath, maxDocumentBytes) }
}
