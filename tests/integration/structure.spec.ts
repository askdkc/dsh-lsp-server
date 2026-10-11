import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { harness } from '../fixtures/harness.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

it('parses JavaScript, JSX, TypeScript and TSX using the bundled grammars and registered queries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-structure-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'app.js'), "import { value } from './value.js';\nfunction greet() { return value }\nconst n = 1\n")
  await writeFile(join(root, 'app.jsx'), 'const View = () => <div />\n')
  await writeFile(join(root, 'app.ts'), 'const label = "日本語😀"\nfunction f() {}\nconst after = 1\n')
  await writeFile(join(root, 'app.tsx'), 'interface Props { name: string }\nexport function View(p: Props) { return <span>{p.name}</span> }\n')
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }

  for (const [file, language] of [['app.js', 'javascript'], ['app.jsx', 'javascript'], ['app.ts', 'typescript'], ['app.tsx', 'tsx']] as const) {
    const snapshot = await code.snapshot.open(scope, file)
    expect(snapshot).toMatchObject({ status: 'ok', language, sourceKind: 'disk' })
    const outline = await code.structure.outline(scope, snapshot.handle, { limit: 20 })
    expect(outline.status).toBe('ok')
    expect(outline.declarations.length).toBeGreaterThan(0)
    await code.snapshot.release(scope, snapshot.handle)
  }

  const javascript = await code.snapshot.open(scope, 'app.js')
  const imports = await code.structure.query(scope, javascript.handle, 'imports', { limit: 10 })
  expect(imports.captures).toMatchObject([{ capture: 'import' }])
  await expect(code.structure.query(scope, javascript.handle, 'arbitrary-query', { limit: 10 })).rejects.toMatchObject({ code: 'LSP_STRUCTURE_UNSUPPORTED' })
  await code.snapshot.release(scope, javascript.handle)
})

it('keeps Tree-sitter ranges in measured UTF-16 units and rejects traversal and symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-unicode-'))
  const outside = await mkdtemp(join(tmpdir(), 'code-outside-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }), () => rm(outside, { recursive: true, force: true }))
  await writeFile(join(root, 'unicode.ts'), 'const label = "日本語😀"\nconst after = 1\n')
  await writeFile(join(outside, 'outside.ts'), 'const secret = 1')
  await symlink(join(outside, 'outside.ts'), join(root, 'escape.ts'))
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'unicode.ts')
  const outline = await code.structure.outline(scope, snapshot.handle, { limit: 10 })
  const after = outline.declarations.find((node: any) => node.name === 'after')
  expect(after.range.start).toEqual({ line: 1, character: 6 })
  expect((await code.structure.span(scope, after.handle, 100)).text).toContain('after = 1')
  await expect(code.snapshot.open(scope, '../code-outside/outside.ts')).rejects.toMatchObject({ code: 'LSP_WORKSPACE_REQUIRED' })
  await expect(code.snapshot.open(scope, 'escape.ts')).rejects.toThrow(/outside workspace/)
  await code.snapshot.release(scope, snapshot.handle)
})

it('returns stale old handles and parses the next file snapshot after edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-incremental-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'edit.ts')
  await writeFile(file, 'const first = 1; // 😀\r\nfunction target() {}\r\n')
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const old = await code.snapshot.open(scope, 'edit.ts')
  const oldOutline = await code.structure.outline(scope, old.handle)
  expect(oldOutline.declarations.some((node: any) => node.name === 'first')).toBe(true)

  await writeFile(file, 'const renamed = 2; // 😀 changed\r\nfunction target() {}\r\n')
  const current = await code.snapshot.open(scope, 'edit.ts')
  expect(current.version).toBe(old.version + 1)
  await expect(code.structure.outline(scope, old.handle)).rejects.toMatchObject({ code: 'LSP_STALE_SNAPSHOT' })
  const updated = await code.structure.outline(scope, current.handle)
  expect(updated.declarations.some((node: any) => node.name === 'renamed')).toBe(true)
  expect(updated.declarations.some((node: any) => node.name === 'first')).toBe(false)
  await code.snapshot.release(scope, old.handle)
  await code.snapshot.release(scope, current.handle)
})

it('does not revoke another owner snapshot when a foreign release is attempted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-owners-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'owned.ts'), 'const owned = 1\n')
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const owner = { ownerId: 'owner-a', sessionId: 'session', workspaceRoot: root }
  const foreign = { ownerId: 'owner-b', sessionId: 'session', workspaceRoot: root }
  const opened = await code.snapshot.open(owner, 'owned.ts')
  const outline = await code.structure.outline(owner, opened.handle)
  const node = outline.declarations[0]
  expect(node.name).toBe('owned')
  expect(await code.snapshot.release(foreign, opened.handle)).toEqual({ released: false })
  expect((await code.structure.span(owner, node.handle)).text).toContain('owned')
  await code.snapshot.release(owner, opened.handle)
})
