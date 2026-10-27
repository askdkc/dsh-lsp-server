import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, writeFile, access, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
const exec = promisify(execFile)
it.each(['0.2.0-rc.2', '0.2.1-alpha.1'])('loads the packed bundle through DSH %s admission and executes LSP queries', async hostVersion => {
  const root = await mkdtemp(join(tmpdir(), 'webstack-package-'))
  try {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'))
    await exec('npm', ['pack', '--ignore-scripts', '--cache', join(root, 'npm-cache'), '--pack-destination', root], { cwd: process.cwd() })
    // npm 10 can print prepare logs even with --ignore-scripts; stdout is not a reliable artifact manifest.
    const archives = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.tgz'))
    expect(archives).toHaveLength(1)
    const packagePath = join(root, 'node_modules', manifest.name)
    // Model the host's services, not the bundle's LSP packages. Never supply
    // dsh-lsp/dsh-tool-lsp from devDependencies: that hides missing published dependencies.
    const hostPackages = [
      '@deepseek-ai/cordis', '@deepseek-ai/schemastery',
      '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-timeout',
      '@deepseek-ai/dsh-fs', '@deepseek-ai/dsh-fs-local',
      '@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-http-proxy',
      '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-sandbox', '@deepseek-ai/dsh-sandbox-policy',
      '@deepseek-ai/dsh-ptc-runtime', '@deepseek-ai/dsh-user-approval',
    ]
    const dependencies = Object.fromEntries(await Promise.all(hostPackages.map(async name => {
      const host = JSON.parse(await readFile(join('node_modules', name, 'package.json'), 'utf8'))
      return [name, name.startsWith('@deepseek-ai/dsh-') ? hostVersion : host.version]
    })))
    // Use the official preflight and its matching Cordis runtime, not a copied evaluator.
    const alpha = hostVersion === '0.2.1-alpha.1'
    Object.assign(dependencies, {
      '@deepseek-ai/dsh-app-boot': hostVersion,
      '@deepseek-ai/dsh-home-paths': hostVersion,
      '@deepseek-ai/dsh-launch-environment': hostVersion,
      '@deepseek-ai/cordis': alpha ? '4.0.5-alpha.1' : '4.0.4',
      '@deepseek-ai/cordis-plugin-group': alpha ? '1.0.5-alpha.1' : '1.0.4',
      '@deepseek-ai/cordis-plugin-loader': alpha ? '1.0.6-alpha.1' : '1.0.5',
      '@deepseek-ai/cordis-plugin-include': alpha ? '1.0.10-alpha.1' : '1.0.9',
    })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      private: true, type: 'module', packageManager: manifest.packageManager,
      dependencies: { ...dependencies, [manifest.name]: `file:${join(root, archives[0]!.name)}` },
      dsh: { profile: { bundles: [manifest.name] } },
    }))
    // Match DSH's profile layout and disabled peer auto-installation.
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    // pnpm 9 reads these settings from CLI/.npmrc; newer DSH installations
    // use pnpm versions that also read them from pnpm-workspace.yaml.
    await exec('corepack', [
      'pnpm', 'install', '--prefer-offline', '--ignore-scripts',
      '--config.node-linker=hoisted', '--config.auto-install-peers=false',
    ], { cwd: root, timeout: 90000 }).catch(error => {
      throw new Error(`Consumer install failed:\n${error.stdout}\n${error.stderr}`, { cause: error })
    })
    for (const entry of Object.values(manifest.exports) as Array<string | { types: string; default: string }>) {
      if (typeof entry === 'object') { await access(join(packagePath, entry.types)); await access(join(packagePath, entry.default)) }
    }
    await writeFile(join(root, 'app.ts'), 'const greeting: string = "hello";\nconsole.log(greeting)')
    await writeFile(join(root, 'app.js'), 'const value = 1;\n')
    await writeFile(join(root, 'app.jsx'), 'const View = () => <div />;\n')
    await writeFile(join(root, 'app.tsx'), 'const View = () => <span />;\n')
    await writeFile(join(root, 'app.php'), '<?php\nclass Greeter { public function greet() {} }\nfunction helper() {}\n')
    await writeFile(join(root, 'js.svelte'), '<h1>😀</h1>\r\n<script context="module">export function shared() {}</script>\r\n<script>const local = 1;</script>\r\n')
    await writeFile(join(root, 'ts.svelte'), '<p>日本語😀</p>\r\n<script lang="ts">interface Props {name: string}\r\nconst label: Props = {name: "x"};</script>\r\n')
    await writeFile(join(root, 'PLAN.md'), '# Plan\n')
    await writeFile(join(root, 'index.html'), '<')
    await writeFile(join(root, 'style.css'), 'a { col }')
    await writeFile(join(root, 'run.sh'), 'greet() { echo hi; }\n')
    await writeFile(join(root, 'math.c'), 'int add(int a, int b) { return a + b; }\n')
    await writeFile(join(root, 'shape.hpp'), 'class Shape { public: int area() { return 1; } };\n')
    await writeFile(join(root, 'Widget.cs'), 'namespace N { class Widget { void Render() {} } }\n')
    await writeFile(join(root, 'server.go'), 'package m\n\nfunc Greet() {}\n')
    await writeFile(join(root, 'Calc.hs'), 'module M where\n\nadd :: Int -> Int\nadd x = x\n')
    await writeFile(join(root, 'Service.java'), 'class Service { void run() {} }\n')
    await writeFile(join(root, 'data.json'), '{"a": 1}\n')
    await writeFile(join(root, 'calc.jl'), 'function area(r) r end\n')
    await writeFile(join(root, 'calc.ml'), 'let double x = x\n')
    await writeFile(join(root, 'calc.mli'), 'val double : int -> int\n')
    await writeFile(join(root, 'calc.py'), 'class Area: pass\n')
    await writeFile(join(root, 'query.dbscheme'), 'mytable(int id: @int ref)\n')
    await writeFile(join(root, 'calc.rb'), 'class Calculator; def area; end; end\n')
    await writeFile(join(root, 'calc.rs'), 'struct Area;\nfn area() {}\n')
    await writeFile(join(root, 'Calc.scala'), 'object Calc { def area: Int = 1 }\n')
    const patch = await readFile(join(packagePath, manifest.dsh.bundle.patch), 'utf8')
    const plugins = [...patch.matchAll(/name: '([^']+)'/g)].map(match => match[1])
    expect(plugins).toHaveLength(4)
    await writeFile(join(root, 'smoke.mjs'), `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      import { pathToFileURL } from 'node:url';
      import { evaluatePluginCompatibility, loadProfileDirectory, composeEntries, prepareProfileEntries } from '@deepseek-ai/dsh-app-boot';
      import { Context } from '@deepseek-ai/cordis';
      import Lsp from '${manifest.name}/lsp';
      import * as standard from '${manifest.name}/tool-lsp';
      import Tools from '@deepseek-ai/dsh-tools';
      import Prompt from '@deepseek-ai/dsh-system-prompt';
      import Fs from '@deepseek-ai/dsh-fs-local';
      import Subprocess from '@deepseek-ai/dsh-subprocess-local';
      import * as provider from '${manifest.name}/provider';
      import * as extra from '${manifest.name}/extra-tool';
      const manifest = JSON.parse(await readFile('${packagePath}/package.json', 'utf8'));
      for (const version of ['0.2.0-rc.2', '0.2.1-alpha.1', '0.3.0-alpha.1', '1.0.0']) {
        assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined);
      }
      const oldManifest = {...manifest, peerDependencies: {'@deepseek-ai/dsh-tools': '0.2.0-rc.2'}};
      assert.ok(evaluatePluginCompatibility(oldManifest, {}, '0.2.1-alpha.1'));
      const profile = loadProfileDirectory('dsh', process.cwd(), '${join(root, 'package.json')}', {userLayer:false});
      assert.equal(profile.skippedBundles.length, 0);
      const rows = composeEntries(profile.layers.map(layer => layer.patches));
      assert.equal(rows.length, 4);
      const preflightContext = new Context();
      preflightContext.provide('profileContext', {dir: process.cwd()});
      const prepared = prepareProfileEntries(preflightContext, rows, pathToFileURL(process.cwd() + '/').href);
      assert.ok(prepared.every(row => !row.disabled));
      assert.deepEqual(prepared.map(row => row.name), ${JSON.stringify(plugins)});
      for (const row of prepared) {
        assert.ok(row.name.startsWith('${manifest.name}/'));
        await import(row.name);
      }
      await preflightContext.fiber.dispose();
      const ctx = new Context();
      try {
        await ctx.plugin(Fs, {cwd: process.cwd()}); await ctx.plugin(Subprocess); await ctx.plugin(Lsp);
        await ctx.plugin(provider, { servers: {phpantom: {enabled:false}}, tailwind:{enabled:false} });
        const code = ctx.get('codeIntelligenceRuntime');
        const scope = {ownerId:'packed-agent',sessionId:'packed-session',workspaceRoot:process.cwd()};
        for (const [file, language, name, text, start] of [
          ['app.js', 'javascript', 'value', 'value = 1', {line:0,character:6}],
          ['app.jsx', 'javascript', 'View', 'View = () => <div />', {line:0,character:6}],
          ['app.ts', 'typescript', 'greeting', 'greeting: string = "hello"', {line:0,character:6}],
          ['app.tsx', 'tsx', 'View', 'View = () => <span />', {line:0,character:6}],
          ['app.php', 'php', 'Greeter', 'class Greeter { public function greet() {} }', {line:1,character:0}],
          ['app.php', 'php', 'greet', 'public function greet() {}', {line:1,character:16}],
          ['app.php', 'php', 'helper', 'function helper() {}', {line:2,character:0}],
          ['js.svelte', 'svelte', 'shared', 'function shared() {}', {line:1,character:32}],
          ['js.svelte', 'svelte', 'local', 'local = 1', {line:2,character:14}],
          ['ts.svelte', 'svelte', 'Props', 'interface Props {name: string}', {line:1,character:18}],
          ['ts.svelte', 'svelte', 'label', 'label: Props = {name: "x"}', {line:2,character:6}],
          ['run.sh', 'bash', 'greet', 'greet() { echo hi; }', {line:0,character:0}],
          ['math.c', 'c', 'add', 'int add(int a, int b) { return a + b; }', {line:0,character:0}],
          ['shape.hpp', 'cpp', 'Shape', 'class Shape { public: int area() { return 1; } }', {line:0,character:0}],
          ['Widget.cs', 'c_sharp', 'Widget', 'class Widget { void Render() {} }', {line:0,character:14}],
          ['server.go', 'go', 'Greet', 'func Greet() {}', {line:2,character:0}],
          ['Calc.hs', 'haskell', 'add', 'add :: Int -> Int', {line:2,character:0}],
          ['Service.java', 'java', 'Service', 'class Service { void run() {} }', {line:0,character:0}],
          ['data.json', 'json', '"a"', '"a": 1', {line:0,character:1}],
          ['calc.jl', 'julia', 'area', 'function area(r) r end', {line:0,character:0}],
          ['calc.ml', 'ocaml', 'double', 'let double x = x', {line:0,character:0}],
          ['calc.mli', 'ocaml_interface', 'double', 'val double : int -> int', {line:0,character:0}],
          ['calc.py', 'python', 'Area', 'class Area: pass', {line:0,character:0}],
          ['query.dbscheme', 'ql_dbscheme', 'mytable', 'mytable(int id: @int ref)', {line:0,character:0}],
          ['calc.rb', 'ruby', 'Calculator', 'class Calculator; def area; end; end', {line:0,character:0}],
          ['calc.rs', 'rust', 'Area', 'struct Area;', {line:0,character:0}],
          ['Calc.scala', 'scala', 'Calc', 'object Calc { def area: Int = 1 }', {line:0,character:0}],
        ]) {
          const snapshot = await code.snapshot.open(scope, file);
          try {
            assert.equal(snapshot.parserAvailable, true, file + ': packed parser unavailable');
            assert.equal(snapshot.language, language);
            assert.equal(snapshot.parseErrors, false);
            const outline = await code.structure.outline(scope, snapshot.handle, {limit:10});
            assert.equal(outline.status, 'ok');
            const declaration = outline.declarations.find(node => node.name === name);
            assert.ok(declaration, file + ': missing declaration');
            assert.deepEqual(declaration.range.start, start);
            assert.deepEqual(declaration.range.end, {line:start.line,character:start.character + text.length});
            const query = await code.structure.query(scope, snapshot.handle, 'declarations', {limit:20});
            assert.equal(query.status, 'ok');
            assert.ok(query.captures.some(capture => capture.capture === 'name' && capture.name === name));
            assert.ok(query.captures.some(capture => capture.capture === 'declaration' && JSON.stringify(capture.range) === JSON.stringify(declaration.range)));
            const span = await code.structure.span(scope, declaration.handle);
            assert.equal(span.status, 'ok');
            assert.equal(span.text, text);
          } finally {
            assert.deepEqual(await code.snapshot.release(scope, snapshot.handle), {released:true});
          }
        }
        const result = await ctx.get('lsp').query({workspaceRoot:process.cwd(),filePath:'app.ts',operation:'hover',position:{line:1,character:14}});
        const html = await ctx.get('webstackLsp').completion({workspaceRoot:process.cwd(),filePath:'index.html',position:{line:0,character:1}});
        const css = await ctx.get('webstackLsp').completion({workspaceRoot:process.cwd(),filePath:'style.css',position:{line:0,character:7}});
        await ctx.plugin(Prompt, {}); await ctx.plugin(Tools, {});
        assert.throws(() => standard.apply(ctx, {maxLocations:200, maxResultChars:32000, timeoutMs:0}), /tool-lsp: timeoutMs/);
        await ctx.plugin(standard, {}); await ctx.plugin(extra, {});
        if (!ctx.get('tools').get('lsp') || !ctx.get('tools').get('lsp_extra')) throw new Error('missing bundled tools');
        const guidance = (await ctx.get('systemPrompt').assemble()).sections.find(section => section.name === 'tool:lsp_extra').text;
        assert.ok(guidance.includes('after editing supported code files'));
        assert.ok(guidance.includes('For Markdown and other unsupported documents'));
        const skipped = await ctx.get('tools').execute({callId:'packed-md',name:'lsp_extra',arguments:{operation:'diagnostics',file_path:'PLAN.md',severity:'all'},signal:new AbortController().signal,agent:{session:{header:{cwd:process.cwd()}}}});
        assert.equal(skipped.isError, false);
        assert.ok(JSON.stringify(skipped).includes('unsupported_file_type'));
        if (extra.name !== 'lsp_extra' || result.kind !== 'hover' || !result.hover?.contents.includes('string')) throw new Error('bad packed provider');
        if (!html.items.some(item => item.label === 'div') || !css.items.some(item => item.label === 'color')) throw new Error('packed HTML/CSS servers failed without dependency scripts');
        console.log('packed provider ok');
      } finally { await ctx.fiber.dispose(); }
    `)
    const result = await exec(process.execPath, ['smoke.mjs'], { cwd: root })
    expect(result.stdout).toContain('packed provider ok')
    // Fresh workers must report a missing bundled grammar, not reuse a prior tree.
    const phpAsset = join(packagePath, 'lib/grammars/tree-sitter-php.wasm')
    const phpBytes = await readFile(phpAsset)
    try {
      await unlink(phpAsset)
      const failed = await exec(process.execPath, ['smoke.mjs'], {cwd:root}).catch(error => error)
      expect(failed.code).toBe(1)
      expect(failed.stderr).toContain('app.php: packed parser unavailable')
    } finally { await writeFile(phpAsset, phpBytes) }
    // A new process cannot hide a dependency import failure behind its module cache.
    const toolEntry = join(root, 'node_modules/@deepseek-ai/dsh-tool-lsp/lib/index.js')
    const original = await readFile(toolEntry, 'utf8')
    try {
      await unlink(toolEntry)
      await writeFile(toolEntry, "throw new Error('upstream tool import sentinel');\n" + original)
      const failed = await exec(process.execPath, ['--input-type=module', '-e', `import '${manifest.name}/tool-lsp'`], {cwd:root}).catch(error => error)
      expect(failed.code).toBe(1)
      expect(failed.stderr).toContain('upstream tool import sentinel')
    } finally { await writeFile(toolEntry, original) }
    const doctor = await exec(process.execPath, [join(packagePath, manifest.bin['dsh-lsp-webstack']), '--json'], { cwd: root }).catch(error => error)
    const report = JSON.parse(doctor.stdout)
    expect(report.servers).toHaveLength(6)
    const badConfig = join(root, 'missing.json')
    await writeFile(badConfig, JSON.stringify({servers:{phpantom:{command:join(root,'missing-phpantom')}}}))
    const missing = await exec(process.execPath, [join(packagePath, manifest.bin['dsh-lsp-webstack']), '--json', '--config', badConfig], {cwd:root}).catch(error => error)
    expect(missing.code).toBe(1)
    expect(JSON.parse(missing.stdout).ok).toBe(false)
    expect(report.servers.filter((server: {source:string;available:boolean}) => server.source === 'bundled').every((server: {available:boolean}) => server.available)).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
