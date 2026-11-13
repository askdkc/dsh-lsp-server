import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'

const exec = promisify(execFile)

// Offline artifact check using the already installed host dependencies. The
// separate published-consumer test still verifies a fresh dependency install.
it('ships a usable Common Lisp parser in the tarball and detects a missing asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packed-commonlisp-'))
  try {
    await exec('npm', ['pack', '--ignore-scripts', '--cache', join(root, 'cache'), '--pack-destination', root])
    const archive = (await readdir(root)).find(name => name.endsWith('.tgz'))!
    await exec('tar', ['-xzf', join(root, archive), '-C', root])
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir')
    const asset = join(root, 'package/lib/grammars/tree-sitter-commonlisp.wasm')
    const manifest = JSON.parse(await readFile(join(root, 'package/lib/grammars/manifest.json'), 'utf8'))
    const entry = manifest.grammars.find((grammar: any) => grammar.language === 'commonlisp')
    expect(createHash('sha256').update(await readFile(asset)).digest('hex')).toBe(entry.sha256)
    expect(await readFile(join(root, 'package/lib/grammars/LICENSE.commonlisp'), 'utf8')).toContain('Permission is hereby granted')
    await writeFile(join(root, 'demo.lisp'), '(defun greet (name) name)\n')
    await writeFile(join(root, 'smoke.mjs'), `
      import assert from 'node:assert/strict';
      import { Context } from '@deepseek-ai/cordis';
      import Lsp from '@deepseek-ai/dsh-lsp';
      import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
      import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local';
      import * as provider from './package/lib/provider.js';
      const ctx = new Context();
      try {
        await ctx.plugin(LocalFileSystem, {cwd:process.cwd()});
        await ctx.plugin(LocalSubprocessService);
        await ctx.plugin(Lsp);
        await ctx.plugin(provider, {servers:{phpantom:{enabled:false}},tailwind:{enabled:false}});
        const code = ctx.get('codeIntelligenceRuntime');
        const scope = {ownerId:'packed',sessionId:'test',workspaceRoot:process.cwd()};
        const snapshot = await code.snapshot.open(scope, 'demo.lisp');
        assert.equal(snapshot.language, 'commonlisp');
        assert.equal(snapshot.parserAvailable, !process.argv.includes('--missing'));
        if (snapshot.parserAvailable) {
          assert.equal(snapshot.parseErrors, false);
          const outline = await code.structure.outline(scope, snapshot.handle);
          assert.equal(outline.status, 'ok');
          assert.deepEqual(outline.declarations.map(n => n.name), ['greet']);
          const span = await code.structure.span(scope, outline.declarations[0].handle);
          assert.equal(span.text, '(defun greet (name) name)');
        }
        await code.snapshot.release(scope, snapshot.handle);
        console.log('Common Lisp artifact verified');
      } finally { await ctx.fiber.dispose(); }
    `)
    expect((await exec(process.execPath, ['smoke.mjs'], { cwd: root })).stdout).toContain('Common Lisp artifact verified')
    await unlink(asset)
    expect((await exec(process.execPath, ['smoke.mjs', '--missing'], { cwd: root })).stdout).toContain('Common Lisp artifact verified')
  } finally { await rm(root, { recursive: true, force: true }) }
})
