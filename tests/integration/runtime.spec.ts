import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { harness } from '../fixtures/harness.js'
const fixture = fileURLToPath(new URL('../fixtures/protocol-server.mjs', import.meta.url))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function setup(mode = 'normal') {
  const root = await mkdtemp(join(tmpdir(), 'webstack-runtime-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'app.ts'), 'const value = 1')
  const trace = join(root, 'trace.jsonl')
  const h = await harness(root, { servers: { phpantom: { enabled: false }, typescript: { mode: 'path', command: process.execPath, args: [fixture, mode, trace], env: { WEBSTACK_TEST_MARKER: 'forwarded' }, configuration: { test: { value: 42 } } } }, tailwind: { enabled: false }, timeouts: { primaryHoverMs: 1000, diagnosticsMs: 500, shutdownMs: 100, killGraceMs: 100 } })
  cleanup.push(h.dispose)
  return { ...h, root, trace, request: { workspaceRoot: root, filePath: 'app.ts', position: {line:0,character:6}, operation: 'hover' as const } }
}
it('uses path command/env/configuration, rejects applyEdit and syncs fresh text', async () => {
  const h = await setup()
  const hover = await h.lsp.query(h.request)
  expect(hover.kind === 'hover' && JSON.parse(hover.hover!.contents)).toMatchObject({ settings: [{ value: 42 }, null], edit: { applied: false }, marker: 'forwarded', source: 'const value = 1' })
  await writeFile(join(h.root, 'app.ts'), 'const value = 2')
  expect(JSON.stringify(await h.lsp.query(h.request))).toContain('const value = 2')
  expect((await h.extra.status()).servers.find(s => s.id === 'typescript')?.liveWorkspaces).toBe(1)
  const locations = await h.lsp.query({ ...h.request, operation: 'goToDefinition' })
  expect(locations).toMatchObject({kind:'locations',locations:[{range:{start:{line:0,character:0}}}]})
  const trace = (await readFile(h.trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(trace.filter(m => m.method === 'textDocument/didOpen')).toHaveLength(3)
  await h.plugin.dispose()
  expect((await readFile(h.trace, 'utf8'))).toContain('shutdown')
})

it('serves structure and semantic queries from an owner-bound, versioned snapshot', async () => {
  const h = await setup()
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  expect(code).toBeDefined()
  const scope = { ownerId: 'agent-a', sessionId: 'session-a', workspaceRoot: h.root }
  const snapshot = await code.snapshot.open(scope, 'app.ts')
  expect(snapshot).toMatchObject({ status: 'ok', version: 1, language: 'typescript', sourceKind: 'disk' })

  const outline = await code.structure.outline(scope, snapshot.handle, { limit: 10 })
  expect(outline.declarations).toMatchObject([{ kind: 'variable', name: 'value', range: { start: { line: 0, character: 6 } } }])
  expect(outline.truncated).toBe(false)

  const semantic = await code.semantic.query(scope, snapshot.handle, { operation: 'hover', position: { line: 0, character: 6 } })
  expect(semantic).toMatchObject({ status: 'ok', operation: 'hover' })
  expect(JSON.stringify(semantic)).toContain('const value = 1')

  await writeFile(join(h.root, 'app.ts'), 'const value = 2')
  await expect(code.structure.outline(scope, snapshot.handle, { limit: 10 })).rejects.toMatchObject({ code: 'LSP_STALE_SNAPSHOT' })
  await expect(code.structure.outline({ ...scope, ownerId: 'agent-b' }, snapshot.handle, { limit: 10 })).rejects.toMatchObject({ code: 'LSP_STALE_SNAPSHOT' })
  await code.snapshot.release(scope, snapshot.handle)
  await h.dispose()
})

it('binds the V1 code contract to the caller scope and returns only bounded protocol DTOs', async () => {
  const h = await setup()
  const service = (h.ctx as any).get('codeIntelligence')
  const signal = new AbortController().signal
  const binding = {
    owner: { agentId: 'agent-a', sessionId: 'session-a' },
    workspaceRoot: h.root,
    scope: {},
    context: { get: (name: string) => (h.ctx as any).get(name, false) },
    assertCurrent() {},
  }
  const lease = await service.bind(binding, signal)
  try {
    const capabilities = await lease.request({ method: 'capabilities' }, signal)
    expect(capabilities).toMatchObject({
      protocol: 'code-intelligence/v1', status: 'ok', sourceKind: 'disk', freshness: 'unknown',
      data: { version: 1, capabilities: ['snapshots', 'structure', 'semantic'], queryIds: ['declarations', 'calls', 'imports'] },
    })

    const opened = await lease.request({ method: 'snapshot.open', path: 'app.ts' }, signal)
    expect(opened).toMatchObject({ protocol: 'code-intelligence/v1', status: 'ok', freshness: 'pinned', data: { path: 'app.ts', language: 'typescript', parseErrors: false } })
    const handle = (opened.data as any).handle as string
    const outline = await lease.request({ method: 'structure.outline', handle, limit: 10 }, signal)
    expect(outline).toMatchObject({ status: 'ok', freshness: 'current', data: { items: [{ kind: 'variable', name: 'value' }] } })
    const nodeHandle = ((outline.data as any).items[0]).handle as string
    const span = await lease.request({ method: 'structure.span', nodeHandle }, signal)
    expect(span).toMatchObject({ status: 'ok', data: { text: 'value = 1' } })
    expect(await lease.request({ method: 'snapshot.release', handle }, signal)).toMatchObject({ status: 'ok', data: { released: true } })
  } finally { await lease.dispose(); await h.dispose() }
})

it('cancels queued work promptly and terminates a server ignoring cancellation', async () => {
  const h = await setup('hang')
  const runningAbort = new AbortController()
  const first = h.lsp.query(h.request, runningAbort.signal)
  const firstError = first.catch(error => error)
  // Wait for observable dispatch rather than guessing server startup duration.
  await expect.poll(async () => readFile(h.trace, 'utf8').catch(() => ''), {timeout:1000}).toContain('textDocument/hover')
  const queuedAbort = new AbortController()
  const queued = h.lsp.query(h.request, queuedAbort.signal)
  queuedAbort.abort()
  await expect(queued).rejects.toMatchObject({name:'AbortError'})
  runningAbort.abort()
  expect(await firstError).toMatchObject({name:'AbortError'})
  expect((await h.extra.status()).servers.find(s => s.id === 'typescript')?.liveWorkspaces).toBe(0)
})
it('bounds a stuck initialize and does not report absent diagnostics as clean', async () => {
  const h = await setup('hang-init')
  await expect(h.lsp.query(h.request)).rejects.toMatchObject({name:'AbortError'})
  const h2 = await setup('no-diagnostics')
  await expect(h2.extra.diagnostics({workspaceRoot:h2.root,filePath:'app.ts'})).rejects.toMatchObject({name:'AbortError'})
}, 5000)
it('does not mistake a previous document close for fresh push diagnostics', async () => {
  const h = await setup('late-close-diagnostics')
  await h.lsp.query(h.request)
  const request = { workspaceRoot: h.root, filePath: 'app.ts' }
  expect((await h.extra.diagnostics(request)).diagnostics).toMatchObject([{ severity: 1, message: 'const value = 1' }])
  await writeFile(join(h.root, 'app.ts'), 'const value = 2')
  expect((await h.extra.diagnostics(request)).diagnostics).toMatchObject([{ severity: 1, message: 'const value = 2' }])
  await writeFile(join(h.root, 'app.ts'), 'clean')
  expect((await h.extra.diagnostics(request)).diagnostics).toEqual([])
})
it('reuses a pull diagnostic server and returns the current document response', async () => {
  const h = await setup('pull-diagnostics')
  await h.lsp.query(h.request)
  const request = { workspaceRoot: h.root, filePath: 'app.ts' }
  expect((await h.extra.diagnostics(request)).diagnostics).toMatchObject([{ message: 'const value = 1' }])
  await writeFile(join(h.root, 'app.ts'), 'const value = 2')
  expect((await h.extra.diagnostics(request)).diagnostics).toMatchObject([{ message: 'const value = 2' }])
  const messages = (await readFile(h.trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(messages.filter(message => message.method === 'initialize')).toHaveLength(1)
})
it('restarts once after a transport failure', async () => {
  const h = await setup('crash-once')
  expect((await h.lsp.query(h.request)).kind).toBe('hover')
  expect((await h.extra.status()).servers.find(s => s.id === 'typescript')?.restarts).toBe(1)
})
it('rejects workspace escape before starting a server', async () => {
  const h = await setup()
  await symlink(fixture, join(h.root, 'outside.ts'))
  await expect(h.lsp.query({...h.request,filePath:'outside.ts'})).rejects.toThrow('outside workspace')
  await expect(readFile(h.trace)).rejects.toMatchObject({code:'ENOENT'})
})
it('rejects strict startup when an enabled executable is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webstack-missing-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await expect(harness(root, {
    missingServerPolicy: 'error',
    servers: { phpantom: { enabled: false }, typescript: { mode: 'path', command: join(root, 'missing-server') } },
    tailwind: { enabled: false },
  })).rejects.toThrow('unavailable language servers: typescript')
})

it('skips unsupported document diagnostics without starting a server or claiming a clean result', async () => {
  const h = await setup()
  await writeFile(join(h.root, 'PLAN.md'), '# Plan\n')
  expect(await h.extra.diagnostics({ workspaceRoot: h.root, filePath: 'PLAN.md' })).toEqual({
    diagnostics: [], skipped: { reason: 'unsupported_file_type', filePath: 'PLAN.md' },
  })
  await expect(readFile(h.trace, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(h.extra.diagnostics({ workspaceRoot: h.root, filePath: 'missing.md' })).rejects.toThrow('regular file')
  await symlink(fixture, join(h.root, 'outside.md'))
  await expect(h.extra.diagnostics({ workspaceRoot: h.root, filePath: 'outside.md' })).rejects.toThrow('outside workspace')
  expect((await h.extra.status()).supportedFileSuffixes).toContain('.ts')
  expect((await h.extra.status()).supportedFileSuffixes).not.toContain('.md')
})
