import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import Tools from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import * as standard from '@deepseek-ai/dsh-tool-lsp'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import * as extra from '../../src/extra-tool.js'
import { harness } from '../fixtures/harness.js'

it('registers both tools in real DSH and enforces session workspace and schemas', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tools-')))
  await writeFile(join(root, 'PLAN.md'), '# Plan\n')
  await writeFile(join(root, 'app.ts'), 'const value: string = "hello";\nconsole.log(value);')
  const h = await harness(root)
  try {
    await h.ctx.plugin(Prompt, {})
    await h.ctx.plugin(Tools, {})
    await h.ctx.plugin(NativeExecutor)
    await h.ctx.plugin(SessionProjections)
    await h.ctx.plugin(Sessions)
    await h.ctx.plugin(WorkingDirectory, { defaultDirectory: root })
    await h.ctx.plugin(standard, {})
    const extraPlugin = h.ctx.plugin(extra, {})
    await extraPlugin
    const tools = h.ctx.get('tools')!
    const guidance = (await h.ctx.get('systemPrompt')!.assemble()).sections.find(section => section.name === 'tool:lsp_extra')!.text
    expect(guidance).toContain('after editing supported code files')
    expect(guidance).toContain('For Markdown and other unsupported documents')
    expect(guidance).toContain('A skipped query is unverified, never a clean result')
    expect(tools.get('lsp')).toBeDefined()
    expect(tools.get('lsp_extra')?.parameters).toMatchObject({ type: 'object' })
    expect((tools.get('lsp_extra')?.parameters as any).properties.operation.enum).toEqual(expect.arrayContaining(['snapshot', 'structure', 'semantic']))
    // Real DSH session/projection/directory services; the idle agent supplies no model.
    const agent = { id: 'fixture-agent', ctx: h.ctx, inject() {}, session: h.ctx.sessions.create(SessionId('fixture-session'), { meta: { cwd: root } }) } as unknown as NonNullable<ToolExecutionInput['agent']>
    const call = async (name: string, args: unknown, withAgent = true) => (await tools.execute({
      calls: [{ type: 'tool-call', id: ToolCallId('test'), name, arguments: JSON.stringify(args) }], signal: new AbortController().signal,
      ...(withAgent ? { agent } : {}),
    })).results[0]!.result
    const hover = await call('lsp', { operation: 'hover', file_path: 'app.ts', line: 2, character: 14 })
    expect(hover).toMatchObject({ isError: false })
    expect(JSON.stringify(hover)).toContain('string')
    const status = await call('lsp_extra', { operation: 'status' }, false)
    expect(status).toMatchObject({ isError: false })
    const snapshot = await call('lsp_extra', { operation: 'snapshot', action: 'open', file_path: 'app.ts' })
    expect(snapshot).toMatchObject({ isError: false })
    expect(JSON.stringify(snapshot)).toContain('"language":"typescript"')
    if (snapshot.isError) throw new Error('snapshot open failed')
    const originalHandle = (snapshot.value as { handle: string }).handle
    const moved = join(root, 'moved')
    await mkdir(moved)
    await writeFile(join(moved, 'app.ts'), 'const movedValue: number = "wrong";\nconsole.log(movedValue);')
    await writeFile(join(moved, 'index.html'), '<')
    await h.ctx.workingDirectory.set(agent, moved)
    expect(agent.session.header.cwd).toBe(root)
    expect(await call('lsp_extra', { operation: 'structure', action: 'outline', handle: originalHandle })).toMatchObject({ isError: true })
    expect(await call('lsp_extra', { operation: 'snapshot', action: 'release', handle: originalHandle })).toMatchObject({ isError: false, value: { released: false } })
    const movedHover = await call('lsp', { operation: 'hover', file_path: 'app.ts', line: 2, character: 14 })
    expect(movedHover).toMatchObject({ isError: false })
    expect(JSON.stringify(movedHover)).toContain('number')
    const diagnostics = await call('lsp_extra', { operation: 'diagnostics', file_path: 'app.ts', severity: 'error' })
    expect(diagnostics).toMatchObject({ isError: false })
    expect(JSON.stringify(diagnostics)).toContain('not assignable')
    const completion = await call('lsp_extra', { operation: 'completion', file_path: 'index.html', line: 1, character: 2 })
    expect(completion).toMatchObject({ isError: false })
    expect(JSON.stringify(completion)).toContain('div')
    const movedSnapshot = await call('lsp_extra', { operation: 'snapshot', action: 'open', file_path: 'app.ts' })
    expect(movedSnapshot).toMatchObject({ isError: false })
    if (movedSnapshot.isError) throw new Error('snapshot open failed')
    const handle = (movedSnapshot.value as { handle: string }).handle
    const outline = await call('lsp_extra', { operation: 'structure', action: 'outline', handle })
    expect(outline).toMatchObject({ isError: false })
    expect(JSON.stringify(outline)).toContain('movedValue')
    const semantic = await call('lsp_extra', { operation: 'semantic', action: 'hover', handle, position_line: 1, position_character: 14 })
    expect(semantic).toMatchObject({ isError: false })
    expect(JSON.stringify(semantic)).toContain('number')
    expect(await call('lsp_extra', { operation: 'snapshot', action: 'release', handle })).toMatchObject({ isError: false, value: { released: true } })
    // DSH restores the original project if the current directory disappears.
    await rm(moved, { recursive: true })
    const skipped = await call('lsp_extra', { operation: 'diagnostics', file_path: 'PLAN.md', severity: 'all' })
    expect(skipped).toMatchObject({ isError: false })
    expect(JSON.stringify(skipped)).toContain('unsupported_file_type')
    expect(h.ctx.workingDirectory.get(agent.session)).toBe(root)
    expect(await call('lsp_extra', { operation: 'snapshot', action: 'release', handle: originalHandle })).toMatchObject({ isError: false, value: { released: true } })
    const missing = await call('lsp_extra', { operation: 'completion', file_path: 'app.ts', line: 1, character: 1 }, false)
    expect(JSON.stringify(missing)).toContain('LSP_WORKSPACE_REQUIRED')
    const invalid = await call('lsp_extra', { operation: 'completion', file_path: 'app.ts', line: 0, character: 1 })
    expect(invalid).not.toMatchObject({ isError: false })
    await extraPlugin.dispose()
    expect(tools.get('lsp_extra')).toBeUndefined()
  } finally { await h.dispose(); await rm(root, { recursive: true, force: true }) }
}, 20000)
