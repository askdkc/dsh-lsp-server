import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { harness } from '../fixtures/harness.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lsp-e2e-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text)
  const h = await harness(root)
  cleanups.push(h.dispose)
  return { ...h, root }
}

describe('bundled servers through real DSH services', () => {
  it('TypeScript: definition, references, hover, diagnostic and completion after edits', async () => {
    const h = await setup({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
      'app.ts': 'const greeting: string = "hello";\nconsole.log(greeting);\nconst broken: number = "wrong";\n',
    })
    const request = { workspaceRoot: h.root, filePath: 'app.ts', position: { line: 1, character: 14 } }
    const definition = await h.lsp.query({ ...request, operation: 'goToDefinition' })
    expect(definition).toMatchObject({ kind: 'locations', locations: [{ range: { start: { line: 0 } } }] })
    const refs = await h.lsp.query({ ...request, operation: 'findReferences' })
    expect(refs.kind === 'locations' && refs.locations.length).toBeGreaterThanOrEqual(2)
    const hover = await h.lsp.query({ ...request, operation: 'hover' })
    expect(hover.kind === 'hover' && hover.hover?.contents).toContain('string')
    const diagnostics = await h.extra.diagnostics({ workspaceRoot: h.root, filePath: 'app.ts' })
    expect(diagnostics.diagnostics.some(d => d.message.includes('not assignable'))).toBe(true)
    await writeFile(join(h.root, 'app.ts'), 'const thing = { specialProperty: 1 };\nthing.\n')
    const completions = await h.extra.completion({ workspaceRoot: h.root, filePath: 'app.ts', position: { line: 1, character: 6 } })
    expect(completions.items.some(item => item.label === 'specialProperty')).toBe(true)
    await h.plugin.dispose()
    await expect(h.lsp.query({ ...request, operation: 'hover' })).rejects.toMatchObject({ code: 'LSP_UNAVAILABLE' })
    expect(h.ctx.get('webstackLsp')).toBeUndefined()
  }, 60000)

  it.each([
    ['JavaScript', 'app.js', 'const entry = { uniqueMember: 1 };\nentry.\n', 1, 6, 'uniqueMember'],
    ['HTML', 'index.html', '<div></div>\n<', 1, 1, 'div'],
    ['CSS', 'style.css', 'a { col }', 0, 7, 'color'],
    ['Svelte', 'App.svelte', '<script>let message = "hi";</script>\n<h1>{message}</h1>\n<', 2, 1, 'div'],
  ])('%s completion', async (_name, file, text, line, character, label) => {
    const h = await setup({ [file]: text })
    const result = await h.extra.completion({ workspaceRoot: h.root, filePath: file, position: { line, character } })
    expect(result.items.some(item => item.label === label)).toBe(true)
  }, 60000)
})
