import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { harness } from '../fixtures/harness.js'
import { createExtraTool } from '../../src/extra-tool.js'
import type { Config } from '../../src/config.js'
const fixture = fileURLToPath(new URL('../fixtures/protocol-server.mjs', import.meta.url))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
async function setup(mode = 'no-diagnostics', timeouts: Config['timeouts'] = {}, strict = false) {
  const root = await mkdtemp(join(tmpdir(), 'diagnostic-budgets-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'app.ts'), 'const value: number = "wrong";')
  await writeFile(join(root, 'other.ts'), 'const other: number = "wrong";')
  const trace = join(root, 'aux.jsonl')
  const h = await harness(root, {
    missingServerPolicy: strict ? 'error' : 'warn',
    servers: { phpantom: { enabled: false }, typescript: { mode: 'path', command: process.execPath, args: [fixture, 'typescript-diagnostics'] }, tailwind: { mode: 'path', command: mode === 'missing' ? join(root, 'missing-server') : process.execPath, args: [fixture, mode, trace] } },
    tailwind: { enabled: true },
    timeouts: { diagnosticsMs: 3000, auxiliaryDiagnosticsMs: 800, diagnosticsRetryMs: 500, shutdownMs: 100, killGraceMs: 100, ...timeouts },
  })
  cleanup.push(h.dispose)
  return { ...h, root, trace, request: { workspaceRoot: root, filePath: 'app.ts' } }
}
it('preserves actual primary diagnostics before an equal external deadline', async () => {
  const h = await setup('no-diagnostics', { diagnosticsMs: 700, auxiliaryDiagnosticsMs: 8000 })
  const result = await h.extra.diagnostics(h.request, AbortSignal.timeout(700))
  expect(result.diagnostics).toMatchObject([{ server: 'typescript', code: 2322, message: 'const value: number = "wrong";' }])
  expect(result.omittedServers).toEqual(['tailwind'])
  expect(result.omissions).toMatchObject([{ server: 'tailwind', reason: 'timeout' }])
})
it('returns both healthy servers without omissions and honors explicit selection', async () => {
  const h = await setup('pull-diagnostics')
  const result = await h.extra.diagnostics(h.request)
  expect(result.omittedServers).toBeUndefined()
  expect(result.diagnostics.flatMap(item => item.servers ?? [item.server])).toEqual(expect.arrayContaining(['typescript', 'tailwind']))
  expect((await h.extra.diagnostics({ ...h.request, servers: ['typescript'] })).diagnostics.every(item => item.server === 'typescript')).toBe(true)
})
it('skips consecutive files during cooldown and automatically probes recovery', async () => {
  const h = await setup('recover-diagnostics')
  expect((await h.extra.diagnostics(h.request)).omissions?.[0]?.reason).toBe('timeout')
  const before = await readFile(h.trace, 'utf8')
  const result = await h.extra.diagnostics({ ...h.request, filePath: 'other.ts' })
  expect(result.omissions?.[0]?.reason).toBe('cooldown')
  expect(result.diagnostics[0]?.message).toContain('other')
  // No new initialize/didOpen was sent for the second file.
  const opens = (text: string) => text.split('\n').filter(line => line.includes('textDocument/didOpen')).length
  expect(opens(await readFile(h.trace, 'utf8'))).toBe(opens(before))
  await writeFile(h.trace + '.ready', '')
  await expect.poll(async () => (await h.extra.diagnostics(h.request)).diagnostics.some(item => item.message === 'recovered auxiliary'), { timeout: 5000, interval: 100 }).toBe(true)
  expect((await h.extra.diagnostics(h.request)).omittedServers).toBeUndefined()
}, 10000)
it('does not enqueue duplicate auxiliary probes for concurrent files', async () => {
  const h = await setup('no-diagnostics', { diagnosticsMs: 5000, auxiliaryDiagnosticsMs: 2000 })
  const first = h.extra.diagnostics(h.request)
  await expect.poll(() => readFile(h.trace, 'utf8').catch(() => ''), { interval: 10, timeout: 3000 }).toContain('textDocument/didOpen')
  const next = await h.extra.diagnostics({ ...h.request, filePath: 'other.ts' })
  expect(next.omissions?.[0]?.reason).toBe('in_progress')
  expect((await first).omissions?.[0]?.reason).toBe('timeout')
})
it('propagates Stop and does not put a user-cancelled server into cooldown', async () => {
  const h = await setup('recover-diagnostics', { diagnosticsMs: 5000, auxiliaryDiagnosticsMs: 2000 })
  const stop = new AbortController()
  const pending = h.extra.diagnostics(h.request, stop.signal).catch(error => error)
  await expect.poll(() => readFile(h.trace, 'utf8').catch(() => ''), { interval: 10, timeout: 3000 }).toContain('textDocument/didOpen')
  stop.abort()
  expect(await pending).toMatchObject({ name: 'AbortError' })
  await writeFile(h.trace + '.ready', '')
  expect((await h.extra.diagnostics(h.request)).omittedServers).toBeUndefined()
}, 10000)
it('keeps strict policy failures distinct from Stop', async () => {
  const h = await setup('no-diagnostics', {}, true)
  await expect(h.extra.diagnostics(h.request)).rejects.toMatchObject({ name: 'TimeoutError' })
})
it('bounds initialization and reports it as a timeout', async () => {
  const h = await setup('hang-init')
  expect((await h.extra.diagnostics(h.request)).omissions?.[0]?.reason).toBe('timeout')
})
it('preserves partial results through extra-tool and snapshot semantic diagnostics with a shorter custom tool deadline', async () => {
  const h = await setup('no-diagnostics', { diagnosticsMs: 60000, auxiliaryDiagnosticsMs: 8000, diagnosticsRetryMs: 1 })
  const code = h.ctx.get('codeIntelligenceRuntime')!
  const tool = createExtraTool(h.extra, code, { timeoutMs: 700 }, { ensure: async () => h.root })
  const exec = { signal: new AbortController().signal, agent: { id: 'test', session: { id: 'test' } } } as any
  const run = (args: any) => tool.execute!(args, exec)
  expect(await run({ operation: 'diagnostics', file_path: 'app.ts' })).toMatchObject({ diagnostics: [{ code: 2322 }], omissions: [{ reason: 'timeout' }] })
  const snapshot = await code.snapshot.open({ ownerId: 'test', sessionId: 'test', workspaceRoot: h.root }, 'app.ts')
  expect(await run({ operation: 'semantic', action: 'diagnostics', handle: snapshot.handle })).toMatchObject({ status: 'partial', result: { diagnostics: [{ code: 2322 }], omissions: [{ reason: 'timeout' }] } })
})

it('returns partial diagnostics through the real DSH native executor before its deadline', async () => {
  const h = await setup('no-diagnostics', { diagnosticsMs: 60000, auxiliaryDiagnosticsMs: 8000 })
  const [{ default: Tools }, { default: Prompt }, NativeExecutor, { default: Sessions }, { default: Projections }, { default: WorkingDirectory }, extra] = await Promise.all([
    import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-system-prompt'), import('@deepseek-ai/dsh-tool-executor-native'),
    import('@deepseek-ai/dsh-session'), import('@deepseek-ai/dsh-session-projection'), import('@deepseek-ai/dsh-working-directory'), import('../../src/extra-tool.js'),
  ])
  await h.ctx.plugin(Prompt, {})
  await h.ctx.plugin(Tools, {})
  await h.ctx.plugin(NativeExecutor)
  await h.ctx.plugin(Sessions)
  await h.ctx.plugin(Projections)
  await h.ctx.plugin(WorkingDirectory, { defaultDirectory: h.root })
  await h.ctx.plugin(extra, { timeoutMs: 900 })
  const agent = { id: 'diagnostic-agent', ctx: h.ctx, inject() {}, session: h.ctx.sessions.create('diagnostic-session' as any, { meta: { cwd: h.root } }) } as any
  const result = await h.ctx.tools.execute({ calls: [{ type: 'tool-call', id: 'diagnostic-call' as any, name: 'lsp_extra', arguments: JSON.stringify({ operation: 'diagnostics', file_path: 'app.ts' }) }], signal: new AbortController().signal, agent })
  expect(result.results[0]?.result).toMatchObject({ isError: false, value: { diagnostics: [{ code: 2322 }], omittedServers: ['tailwind'], omissions: [{ reason: 'timeout' }] } })
})

it('reports a missing auxiliary executable without discarding primary errors', async () => {
  const h = await setup('missing')
  expect(await h.extra.diagnostics(h.request)).toMatchObject({ diagnostics: [{ code: 2322 }], omittedServers: ['tailwind'], omissions: [{ reason: 'unavailable' }] })
})
