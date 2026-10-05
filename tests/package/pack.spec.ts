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
    await writeFile(join(root, 'index.html'), '<')
    await writeFile(join(root, 'style.css'), 'a { col }')
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
        const result = await ctx.get('lsp').query({workspaceRoot:process.cwd(),filePath:'app.ts',operation:'hover',position:{line:1,character:14}});
        const html = await ctx.get('webstackLsp').completion({workspaceRoot:process.cwd(),filePath:'index.html',position:{line:0,character:1}});
        const css = await ctx.get('webstackLsp').completion({workspaceRoot:process.cwd(),filePath:'style.css',position:{line:0,character:7}});
        await ctx.plugin(Prompt, {}); await ctx.plugin(Tools, {});
        assert.throws(() => standard.apply(ctx, {maxLocations:200, maxResultChars:32000, timeoutMs:0}), /tool-lsp: timeoutMs/);
        await ctx.plugin(standard, {}); await ctx.plugin(extra, {});
        if (!ctx.get('tools').get('lsp') || !ctx.get('tools').get('lsp_extra')) throw new Error('missing bundled tools');
        if (extra.name !== 'lsp_extra' || result.kind !== 'hover' || !result.hover?.contents.includes('string')) throw new Error('bad packed provider');
        if (!html.items.some(item => item.label === 'div') || !css.items.some(item => item.label === 'color')) throw new Error('packed HTML/CSS servers failed without dependency scripts');
        console.log('packed provider ok');
      } finally { await ctx.fiber.dispose(); }
    `)
    const result = await exec(process.execPath, ['smoke.mjs'], { cwd: root })
    expect(result.stdout).toContain('packed provider ok')
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
