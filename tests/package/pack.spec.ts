import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, mkdir, symlink, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
const exec = promisify(execFile)
it('loads the packed exports, declarations, CLI and provider from an isolated consumer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webstack-package-'))
  try {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'))
    const packed = await exec('npm', ['pack', '--ignore-scripts', '--json', '--cache', join(root, 'npm-cache'), '--pack-destination', root], { cwd: process.cwd() })
    const archive = JSON.parse(packed.stdout)[0]
    const packagePath = join(root, 'node_modules', manifest.name)
    await mkdir(packagePath, { recursive: true })
    await exec('tar', ['-xzf', join(root, archive.filename), '--strip-components=1', '-C', packagePath])
    // DSH owns the peer services; supply the actual installed peers to this separate consumer.
    for (const dependency of new Set([...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)])) {
      const target = join(root, 'node_modules', dependency)
      await mkdir(resolve(target, '..'), { recursive: true })
      await symlink(resolve('node_modules', dependency), target, 'dir')
    }
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
