import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { harness } from '../fixtures/harness.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

it.each(['lisp', 'lsp', 'cl', 'asd'])('parses Common Lisp .%s files through the runtime', async extension => {
  const root = await mkdtemp(join(tmpdir(), 'code-commonlisp-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const file = `example.${extension}`
  const source = '; 日本語😀\n(defpackage :demo (:use :cl))\n(in-package :demo)\n(defun greet (name) (format nil "Hello ~a" name))\n(DEFMACRO WITH-X (x) x)\n(defgeneric value (obj))\n(defmethod (setf value) (new obj) new)\n(defclass person () ())\n(defstruct point x y)\n(defparameter *count* 0)\n(cl:defvar *flag* nil)\n; (defun commented () nil)\n"(defun string-only () nil)"\n'
  await writeFile(join(root, file), source)
  const h = await harness(root)
  cleanup.push(h.dispose)
  const code = (h.ctx as any).get('codeIntelligenceRuntime')
  const scope = { ownerId: 'agent', sessionId: 'session', workspaceRoot: root }
  expect(code.capabilities().parsers).toContainEqual(expect.objectContaining({ language: 'commonlisp', available: true, extensions: ['.lisp', '.lsp', '.cl', '.asd'] }))
  const snapshot = await code.snapshot.open(scope, file)
  expect(snapshot).toMatchObject({ language: 'commonlisp', parserAvailable: true, parseErrors: false })
  const outline = await code.structure.outline(scope, snapshot.handle)
  expect(outline.status).toBe('ok')
  expect(outline.declarations.map((n: any) => n.name)).toEqual([':demo', 'greet', 'WITH-X', 'value', '(setf value)', 'person', 'point', '*count*', '*flag*'])
  const greet = outline.declarations.find((n: any) => n.name === 'greet')
  expect(greet.range.start).toEqual({ line: 3, character: 0 })
  expect((await code.structure.span(scope, greet.handle)).text).toBe('(defun greet (name) (format nil "Hello ~a" name))')
  const imports = await code.structure.query(scope, snapshot.handle, 'imports')
  expect(imports.status).toBe('ok')
  expect(imports.captures.filter((n: any) => n.capture === 'import')).toHaveLength(2)
  expect((await code.structure.enclosing(scope, snapshot.handle, { line: 3, character: 10 })).status).toBe('ok')
  await expect(code.structure.query(scope, snapshot.handle, 'calls')).rejects.toMatchObject({ code: 'LSP_STRUCTURE_UNSUPPORTED' })
  await code.snapshot.release(scope, snapshot.handle)
  await writeFile(join(root, file), '(asdf:defsystem :demo :components ((:file "demo")))\n')
  const system = await code.snapshot.open(scope, file)
  expect((await code.structure.outline(scope, system.handle)).declarations.map((n: any) => n.name)).toEqual([':demo'])
  await code.snapshot.release(scope, system.handle)
  await writeFile(join(root, file), '')
  const empty = await code.snapshot.open(scope, file)
  expect((await code.structure.outline(scope, empty.handle))).toMatchObject({ status: 'ok', declarations: [] })
  await code.snapshot.release(scope, empty.handle)
  await writeFile(join(root, file), '(defun broken (x)\n')
  const broken = await code.snapshot.open(scope, file)
  expect(broken).toMatchObject({ parserAvailable: true, parseErrors: true })
  expect((await code.structure.outline(scope, broken.handle)).status).toBe('partial')
})
