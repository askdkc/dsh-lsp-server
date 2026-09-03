import { describe, expect, it } from 'vitest'
import { canonicalizeWorkspace, resolveWorkspaceSource, type WorkspaceFileSystem } from '../../src/host/workspace.js'

function fakeFs(files: Record<string, string>, links: Record<string, string> = {}): WorkspaceFileSystem {
  return {
    realpath: async (path) => links[path] ?? path,
    stat: async (path) => ({ isFile: () => path in files }),
    readFile: async (path) => files[path] ?? '',
  }
}

describe('workspace source boundary', () => {
  it('allows a regular UTF-8 file inside the canonical workspace', async () => {
    const fs = fakeFs({ '/work/app/file.ts': 'const ok = true' })
    const workspace = await canonicalizeWorkspace(fs, '/work/app')
    await expect(resolveWorkspaceSource(fs, workspace, 'file.ts', 100)).resolves.toMatchObject({ path: '/work/app/file.ts', text: 'const ok = true' })
  })

  it('rejects traversal and symlink escapes before returning source', async () => {
    const fs = fakeFs({ '/work/app/file.ts': 'ok', '/outside/secret.ts': 'secret' }, { '/work/app/link.ts': '/outside/secret.ts' })
    const workspace = await canonicalizeWorkspace(fs, '/work/app')
    await expect(resolveWorkspaceSource(fs, workspace, '../outside/secret.ts', 100)).rejects.toThrow('outside')
    await expect(resolveWorkspaceSource(fs, workspace, 'link.ts', 100)).rejects.toThrow('outside')
  })

  it('rejects non-files and oversized documents', async () => {
    const fs = fakeFs({ '/work/app/large.ts': '12345' })
    const workspace = await canonicalizeWorkspace(fs, '/work/app')
    await expect(resolveWorkspaceSource(fs, workspace, 'large.ts', 4)).rejects.toThrow('limit')
    await expect(resolveWorkspaceSource(fs, workspace, 'missing.ts', 100)).rejects.toThrow()
  })
})
