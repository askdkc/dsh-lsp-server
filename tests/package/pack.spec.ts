import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
const exec = promisify(execFile)
it('installs the packed bundle with its LSP service and tool in a fresh DSH consumer', async () => {
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
      '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-timeout',
      '@deepseek-ai/dsh-fs', '@deepseek-ai/dsh-fs-local',
      '@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-http-proxy',
      '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-session',
    ]
    const dependencies = Object.fromEntries(await Promise.all(hostPackages.map(async name => {
      const host = JSON.parse(await readFile(join('node_modules', name, 'package.json'), 'utf8'))
      return [name, host.version]
    })))
    await writeFile(join(root, 'package.json'), JSON.stringify({
      private: true, type: 'module', packageManager: manifest.packageManager,
      dependencies: { ...dependencies, [manifest.name]: `file:${join(root, archives[0]!.name)}` },
    }))
    // Match DSH's profile layout and disabled peer auto-installation.
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    // pnpm 9 reads these settings from CLI/.npmrc; newer DSH installations
    // use pnpm versions that also read them from pnpm-workspace.yaml.
    await exec('pnpm', [
      'install', '--prefer-offline', '--ignore-scripts',
      '--config.node-linker=hoisted', '--config.auto-install-peers=false',
    ], { cwd: root, timeout: 90000 }).catch(error => {
      throw new Error(`Consumer install failed:\n${error.stdout}\n${error.stderr}`, { cause: error })
    })
    for (const entry of Object.values(manifest.exports) as Array<string | { types: string; default: string }>) {
      if (typeof entry === 'object') { await access(join(packagePath, entry.types)); await access(join(packagePath, entry.default)) }
    }
    await writeFile(join(root, 'app.ts'), 'const greeting: string = "hello";\nconsole.log(greeting)')
    const patch = await readFile(join(packagePath, manifest.dsh.bundle.patch), 'utf8')
    const plugins = [...patch.matchAll(/name: '([^']+)'/g)].map(match => match[1])
    expect(plugins).toHaveLength(4)
    await writeFile(join(root, 'smoke.mjs'), `
      import { Context } from '@deepseek-ai/cordis';
      import Lsp from '@deepseek-ai/dsh-lsp';
      import * as standard from '@deepseek-ai/dsh-tool-lsp';
      import Tools from '@deepseek-ai/dsh-tools';
      import Prompt from '@deepseek-ai/dsh-system-prompt';
      import Fs from '@deepseek-ai/dsh-fs-local';
      import Subprocess from '@deepseek-ai/dsh-subprocess-local';
      import * as provider from '${manifest.name}/provider';
      import * as extra from '${manifest.name}/extra-tool';
      for (const name of ${JSON.stringify(plugins)}) await import(name);
      const ctx = new Context();
      try {
        await ctx.plugin(Fs, {cwd: process.cwd()}); await ctx.plugin(Subprocess); await ctx.plugin(Lsp);
        await ctx.plugin(provider, { servers: {phpantom: {enabled:false}}, tailwind:{enabled:false} });
        const result = await ctx.get('lsp').query({workspaceRoot:process.cwd(),filePath:'app.ts',operation:'hover',position:{line:1,character:14}});
        await ctx.plugin(Prompt, {}); await ctx.plugin(Tools, {});
        await ctx.plugin(standard, {}); await ctx.plugin(extra, {});
        if (!ctx.get('tools').get('lsp') || !ctx.get('tools').get('lsp_extra')) throw new Error('missing bundled tools');
        if (extra.name !== 'lsp_extra' || result.kind !== 'hover' || !result.hover?.contents.includes('string')) throw new Error('bad packed provider');
        console.log('packed provider ok');
      } finally { await ctx.fiber.dispose(); }
    `)
    const result = await exec(process.execPath, ['smoke.mjs'], { cwd: root })
    expect(result.stdout).toContain('packed provider ok')
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
