import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Tools from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as standard from '@deepseek-ai/dsh-tool-lsp'
import * as extra from '../../src/extra-tool.js'
import { harness } from '../fixtures/harness.js'

it('registers both tools in real DSH and enforces session workspace and schemas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tools-'))
  await writeFile(join(root, 'app.ts'), 'const value: string = "hello";\nconsole.log(value);')
  const h = await harness(root)
  try {
    await h.ctx.plugin(Prompt, {})
    await h.ctx.plugin(Tools, {})
    await h.ctx.plugin(standard, {})
    const extraPlugin = h.ctx.plugin(extra, {})
    await extraPlugin
    const tools = h.ctx.get('tools')!
    expect(tools.get('lsp')).toBeDefined()
    expect(tools.get('lsp_extra')?.parameters).toMatchObject({ type: 'object' })
    const call = (name: string, args: unknown, withAgent = true) => tools.execute({
      callId: CallId('test'), name, arguments: args, signal: new AbortController().signal,
      // The tool only reads the session cwd; no model or network is involved.
      ...(withAgent ? { agent: { session: { header: { cwd: root } } } as NonNullable<ToolExecutionInput['agent']> } : {}),
    })
    const hover = await call('lsp', { operation: 'hover', file_path: 'app.ts', line: 2, character: 14 })
    expect(hover).toMatchObject({ isError: false })
    expect(JSON.stringify(hover)).toContain('string')
    const status = await call('lsp_extra', { operation: 'status' }, false)
    expect(status).toMatchObject({ isError: false })
    const missing = await call('lsp_extra', { operation: 'completion', file_path: 'app.ts', line: 1, character: 1 }, false)
    expect(JSON.stringify(missing)).toContain('LSP_WORKSPACE_REQUIRED')
    const invalid = await call('lsp_extra', { operation: 'completion', file_path: 'app.ts', line: 0, character: 1 })
    expect(invalid).not.toMatchObject({ isError: false })
    await extraPlugin.dispose()
    expect(tools.get('lsp_extra')).toBeUndefined()
  } finally { await h.dispose(); await rm(root, { recursive: true, force: true }) }
}, 20000)
