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

it('exposes named PHP classes, functions and methods through the existing declarations query', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-php-structure-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const source = '<?php\r\n// 日本語😀\r\nnamespace App;\r\nclass Greeter {\r\n  public function hello(string $name): string { return $name; }\r\n}\r\nfunction make(): Greeter { return new Greeter(); }\r\n$callback = function () {};\r\n$object = new class {};\r\n'
  await writeFile(join(root, 'app.php'), source)
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'app.php')
  expect(snapshot).toMatchObject({ status: 'ok', language: 'php', parserAvailable: true, parseErrors: false })

  const outline = await code.structure.outline(scope, snapshot.handle)
  expect(outline.status).toBe('ok')
  expect(outline.declarations.map((node: any) => [node.name, node.kind])).toEqual([
    ['Greeter', 'class'], ['hello', 'method'], ['make', 'function'],
  ])
  const query = await code.structure.query(scope, snapshot.handle, 'declarations')
  expect(query.status).toBe('ok')
  expect(query.captures.filter((capture: any) => capture.capture === 'name').map((capture: any) => capture.name)).toEqual(['Greeter', 'hello', 'make'])
  expect(await code.structure.outline(scope, snapshot.handle, { limit: 1 })).toMatchObject({ declarations: [expect.anything()], processed: 1, truncated: true })
  expect(await code.structure.query(scope, snapshot.handle, 'declarations', { limit: 1 })).toMatchObject({ captures: [expect.anything()], processed: 1, truncated: true })
  await expect(code.structure.query(scope, snapshot.handle, 'calls')).rejects.toMatchObject({ code: 'LSP_STRUCTURE_UNSUPPORTED' })
  const make = outline.declarations.find((node: any) => node.name === 'make')
  const makeText = 'function make(): Greeter { return new Greeter(); }'
  expect(make.range).toEqual(sourceRange(source, source.indexOf(makeText), makeText.length))
  expect((await code.structure.span(scope, make.handle)).text).toBe(makeText)
  const hello = outline.declarations.find((node: any) => node.name === 'hello')
  expect((await code.structure.span(scope, hello.handle)).text).toBe('public function hello(string $name): string { return $name; }')
  await code.snapshot.release(scope, snapshot.handle)
})

it('keeps valid PHP declarations available when a later declaration is malformed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-php-malformed-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'Malformed.php'), '<?php function ready(): void {} function broken(')
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'Malformed.php')
  expect(snapshot).toMatchObject({ language: 'php', parserAvailable: true, parseErrors: true })
  const outline = await code.structure.outline(scope, snapshot.handle)
  expect(outline).toMatchObject({ status: 'partial', errors: { hasError: true } })
  const ready = outline.declarations.find((node: any) => node.name === 'ready')
  expect(ready).toBeDefined()
  expect((await code.structure.span(scope, ready.handle)).text).toBe('function ready(): void {}')
  const query = await code.structure.query(scope, snapshot.handle, 'declarations')
  expect(query).toMatchObject({ status: 'partial', errors: { hasError: true } })
  expect(query.captures.some((capture: any) => capture.capture === 'name' && capture.name === 'ready')).toBe(true)
  await code.snapshot.release(scope, snapshot.handle)
})

it('keeps Svelte JavaScript declarations and spans at original UTF-16 offsets without parsing markup or comments as scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-svelte-js-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const source = '<!-- <script>function hidden() {}</script> -->\r\n<p>日本語😀</p><script>const face = "😀"; function greet() { return face }</script>\r\n<style>.fake::after { content: "function cssOnly() {}"; }</style>\r\n'
  await writeFile(join(root, 'View.svelte'), source)
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'View.svelte')
  expect(snapshot).toMatchObject({ language: 'svelte', parserAvailable: true, parseErrors: false })
  const outline = await code.structure.outline(scope, snapshot.handle)
  expect(outline.status).toBe('ok')
  expect(outline.declarations.map((node: any) => node.name)).toEqual(['face', 'greet'])
  const greet = outline.declarations.find((node: any) => node.name === 'greet')
  const greetText = 'function greet() { return face }'
  const greetRange = sourceRange(source, source.indexOf(greetText), greetText.length)
  expect(greet.range).toEqual(greetRange)
  expect((await code.structure.span(scope, greet.handle)).text).toBe(greetText)

  const query = await code.structure.query(scope, snapshot.handle, 'declarations', { range: greetRange })
  expect(query.captures.filter((capture: any) => capture.capture === 'name').map((capture: any) => capture.name)).toEqual(['greet'])
  const declaration = query.captures.find((capture: any) => capture.capture === 'declaration')
  expect(declaration.range).toEqual(greetRange)
  expect((await code.structure.span(scope, declaration.nodeHandle)).text).toBe(greetText)
  const enclosing = await code.structure.enclosing(scope, snapshot.handle, sourcePosition(source, source.indexOf('return face')), { kinds: ['function_declaration'] })
  expect(enclosing.node).toMatchObject({ kind: 'function', range: greetRange })
  const markup = await code.structure.enclosing(scope, snapshot.handle, sourcePosition(source, source.indexOf('日本語')))
  expect(markup.node).toBeUndefined()
  expect(markup.ancestors).toEqual([])
  await code.snapshot.release(scope, snapshot.handle)
})

it.each(['module', 'context="module"'])('reads both Svelte TypeScript script contexts (%s) at their original positions', async moduleAttribute => {
  const root = await mkdtemp(join(tmpdir(), 'code-svelte-ts-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const source = `<script ${moduleAttribute} lang="ts">\r\nexport interface Settings { label: string }\r\nexport const shared: Settings = { label: '😀' };\r\n</script>\r\n<h1>日本語😀</h1>\r\n<script lang='ts'>type Local = string; function select(value: Local): Local { return value }</script>\r\n`
  await writeFile(join(root, 'Typed.svelte'), source)
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'Typed.svelte')
  expect(snapshot).toMatchObject({ language: 'svelte', parserAvailable: true, parseErrors: false })
  const outline = await code.structure.outline(scope, snapshot.handle)
  expect(outline.status).toBe('ok')
  expect(outline.declarations.map((node: any) => [node.name, node.kind])).toEqual([
    ['Settings', 'interface'], ['shared', 'variable'], ['Local', 'type'], ['select', 'function'],
  ])
  const query = await code.structure.query(scope, snapshot.handle, 'declarations')
  expect(query.captures.filter((capture: any) => capture.capture === 'name').map((capture: any) => capture.name)).toEqual(['Settings', 'shared', 'Local', 'select'])
  const secondBlock = sourceRange(source, source.indexOf('type Local'), source.indexOf('</script>', source.indexOf('type Local')) - source.indexOf('type Local'))
  const selected = await code.structure.query(scope, snapshot.handle, 'declarations', { range: secondBlock })
  expect(selected.captures.filter((capture: any) => capture.capture === 'name').map((capture: any) => capture.name)).toEqual(['Local', 'select'])
  for (const node of outline.declarations) {
    const span = await code.structure.span(scope, node.handle)
    const index = source.indexOf(span.text)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(node.range).toEqual(sourceRange(source, index, span.text.length))
    expect(span.text).not.toContain('<script')
  }
  await code.snapshot.release(scope, snapshot.handle)
})

it.each(['<h1>No script</h1>', '<script></script><p>Empty</p>', '<script module></script><script lang="ts">/* empty */</script>'])('returns an empty Svelte structure for %s', async source => {
  const root = await mkdtemp(join(tmpdir(), 'code-svelte-empty-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'Empty.svelte'), source)
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'Empty.svelte')
  expect(snapshot).toMatchObject({ language: 'svelte', parserAvailable: true, parseErrors: false })
  expect(await code.structure.outline(scope, snapshot.handle)).toMatchObject({ status: 'ok', declarations: [], processed: 0, truncated: false })
  expect(await code.structure.query(scope, snapshot.handle, 'declarations')).toMatchObject({ status: 'ok', captures: [], processed: 0, truncated: false })
  await code.snapshot.release(scope, snapshot.handle)
})

it('invalidates Svelte node handles and reparses scripts after markup moves them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-svelte-edit-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'Edit.svelte')
  await writeFile(file, '<script>function before() {}</script>')
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const old = await code.snapshot.open(scope, 'Edit.svelte')
  expect(old).toMatchObject({ language: 'svelte', parserAvailable: true })
  const oldOutline = await code.structure.outline(scope, old.handle)
  expect(oldOutline.declarations[0].name).toBe('before')
  const source = '<p>😀 moved</p>\r\n<script lang="ts">function after(): void {}</script>'
  await writeFile(file, source)
  const current = await code.snapshot.open(scope, 'Edit.svelte')
  expect(current.version).toBe(old.version + 1)
  await expect(code.structure.outline(scope, old.handle)).rejects.toMatchObject({ code: 'LSP_STALE_SNAPSHOT' })
  await expect(code.structure.span(scope, oldOutline.declarations[0].handle)).rejects.toMatchObject({ code: 'LSP_STALE_SNAPSHOT' })
  const updated = await code.structure.outline(scope, current.handle)
  expect(updated.status).toBe('ok')
  expect(updated.declarations.map((node: any) => node.name)).toEqual(['after'])
  const afterText = 'function after(): void {}'
  expect(updated.declarations[0].range).toEqual(sourceRange(source, source.indexOf(afterText), afterText.length))
  expect((await code.structure.span(scope, updated.declarations[0].handle)).text).toBe(afterText)
  await code.snapshot.release(scope, old.handle)
  await code.snapshot.release(scope, current.handle)
})

it.each([
  '<p>{"<script>"}</p>',
  '<p title="<script>">😀</p>',
  '<p>{"<style>"}</p><style>p { color: red }</style>',
  '<p title="<style>">日本語😀</p><style>p { color: red }</style>',
])('ignores tag-looking Svelte markup before actual scripts: %s', async markup => {
  const root = await mkdtemp(join(tmpdir(), 'code-svelte-tag-text-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const declarationText = 'function actual() {}'
  const source = `${markup}<script>${declarationText}</script>`
  await writeFile(join(root, 'TagText.svelte'), source)
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'TagText.svelte')
  expect(snapshot).toMatchObject({ language: 'svelte', parserAvailable: true, parseErrors: false })
  const outline = await code.structure.outline(scope, snapshot.handle)
  expect(outline.status).toBe('ok')
  expect(outline.declarations.map((node: any) => node.name)).toEqual(['actual'])
  const expectedRange = sourceRange(source, source.indexOf(declarationText), declarationText.length)
  expect(outline.declarations[0].range).toEqual(expectedRange)
  expect((await code.structure.span(scope, outline.declarations[0].handle)).text).toBe(declarationText)
  const query = await code.structure.query(scope, snapshot.handle, 'declarations')
  expect(query.status).toBe('ok')
  expect(query.captures.find((capture: any) => capture.capture === 'declaration').range).toEqual(expectedRange)
  await code.snapshot.release(scope, snapshot.handle)
})

it('reports malformed Svelte JavaScript as partial while retaining valid declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-svelte-malformed-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const source = '<script>function ready() {}\nfunction broken( {</script>'
  await writeFile(join(root, 'Malformed.svelte'), source)
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'Malformed.svelte')
  expect(snapshot).toMatchObject({ language: 'svelte', parserAvailable: true, parseErrors: true })
  const outline = await code.structure.outline(scope, snapshot.handle)
  expect(outline).toMatchObject({ status: 'partial', errors: { hasError: true } })
  const ready = outline.declarations.find((node: any) => node.name === 'ready')
  expect(ready).toBeDefined()
  expect((await code.structure.span(scope, ready.handle)).text).toBe('function ready() {}')
  const query = await code.structure.query(scope, snapshot.handle, 'declarations')
  expect(query).toMatchObject({ status: 'partial', errors: { hasError: true } })
  expect(query.captures.some((capture: any) => capture.capture === 'name' && capture.name === 'ready')).toBe(true)
  await code.snapshot.release(scope, snapshot.handle)
})

it('uses host-normalized Svelte snapshot coordinates when DSH strips the UTF-8 BOM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-svelte-bom-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const source = '\uFEFF<p>😀</p><script>function afterBom() {}</script>'
  await writeFile(join(root, 'Bom.svelte'), source)
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  const snapshot = await code.snapshot.open(scope, 'Bom.svelte')
  expect(snapshot).toMatchObject({ language: 'svelte', parserAvailable: true, parseErrors: false })
  const outline = await code.structure.outline(scope, snapshot.handle)
  const declaration = outline.declarations.find((node: any) => node.name === 'afterBom')
  const text = 'function afterBom() {}'
  // The DSH fs.streamText contract normalizes CRLF and strips the BOM before
  // the plugin receives its source. Structure positions match that snapshot.
  const hostSource = source.slice(1)
  expect(declaration.range).toEqual(sourceRange(hostSource, hostSource.indexOf(text), text.length))
  expect((await code.structure.span(scope, declaration.handle)).text).toBe(text)
  await code.snapshot.release(scope, snapshot.handle)
})

it('does not expand structure parsing into Blade or Markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'code-structure-unsupported-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'view.blade.php'), '@php function bladeOnly() {} @endphp')
  await writeFile(join(root, 'README.md'), '```php\n<?php function fenced() {}\n```')
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  for (const file of ['view.blade.php', 'README.md']) {
    const snapshot = await code.snapshot.open(scope, file)
    expect(snapshot).toMatchObject({ language: null, parserAvailable: false })
    expect(await code.structure.outline(scope, snapshot.handle)).toMatchObject({ status: 'unsupported', declarations: [] })
    await expect(code.structure.query(scope, snapshot.handle, 'declarations')).rejects.toMatchObject({ code: 'LSP_STRUCTURE_UNSUPPORTED' })
    await code.snapshot.release(scope, snapshot.handle)
  }
})

function sourcePosition(source: string, index: number) {
  const lines = source.slice(0, index).split(/\r\n|\r|\n/u)
  return { line: lines.length - 1, character: lines.at(-1)!.length }
}

function sourceRange(source: string, start: number, length: number) {
  return { start: sourcePosition(source, start), end: sourcePosition(source, start + length) }
}
