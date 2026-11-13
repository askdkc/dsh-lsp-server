import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { resolveConsumerHost } from '../package/consumer-host.js'
it('resolves mixed installed versions and unexported manifests, never substituting missing packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'consumer-host-'))
  try {
    for (const [name, version, hidden] of [['a', '0.2.2-rc.2', false], ['b', '4.0.6-alpha.2', true]] as const) {
      const directory = join(root, 'node_modules', '@test', name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `@test/${name}`, version, ...(hidden ? { exports: './index.js' } : {}) }))
      await writeFile(join(directory, 'index.js'), '')
    }
    expect(await resolveConsumerHost(root, ['@test/a', '@test/b'])).toEqual({ '@test/a': '0.2.2-rc.2', '@test/b': '4.0.6-alpha.2' })
    await expect(resolveConsumerHost(root, ['@test/missing'])).rejects.toThrow('no version substitution')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('resolves per-package published channels and rejects absent explicitly requested tags', async () => {
  const { resolvePublishedConsumer } = await import('../package/consumer-host.js')
  const tags: Record<string, Record<string, string>> = { a: { latest: '1.2.3', next: '2.0.0-beta.1' }, b: { next: '4.5.6-rc.1' } }
  const lookup = async (name: string) => tags[name]!
  expect(await resolvePublishedConsumer(['a', 'b'], lookup)).toEqual({ a: tags.a!.next, b: tags.b!.next })
  expect(await resolvePublishedConsumer(['a'], lookup, { a: 'next' })).toEqual({ a: tags.a!.next })
  await expect(resolvePublishedConsumer(['a'], lookup, { a: 'alpha' })).rejects.toThrow('No published consumer version')
  await expect(resolvePublishedConsumer(['a'], lookup, { a: '1.2.3' })).rejects.toThrow('Invalid consumer tag')
})

// The package versions here are fixtures, not compatibility gates.
it('does not let a stale latest tag mask newer release channels', async () => {
  const { resolvePublishedConsumer } = await import('../package/consumer-host.js')
  const metadata = {
    tools: { latest: '0.0.1-rc.1', alpha: '0.2.2-alpha.3', rc: '0.2.2-rc.2' },
    executor: { latest: '0.2.2-alpha.2', rc: '0.2.2-rc.2' },
    core: { latest: '4.1.0', next: '4.0.6-alpha.2' },
  }
  expect(await resolvePublishedConsumer(Object.keys(metadata), async name => metadata[name as keyof typeof metadata])).toEqual({ tools: '0.2.2-rc.2', executor: '0.2.2-rc.2', core: '4.1.0' })
  expect(await resolvePublishedConsumer(['tools'], async () => metadata.tools, { tools: 'latest' })).toEqual({ tools: metadata.tools.latest })
})

it.each([
  [{ latest: '1.9.0', next: '1.10.0' }, '1.10.0'],
  [{ latest: '1.0.0-rc.9', next: '1.0.0-rc.10' }, '1.0.0-rc.10'],
  [{ latest: '1.0.0', rc: '1.0.0-rc.99' }, '1.0.0'],
  [{ alpha: '1.0.0-alpha.1', beta: '1.0.0-beta.1' }, '1.0.0-beta.1'],
  [{ latest: '1.0.0+build.1', next: '1.0.0+build.2' }, '1.0.0+build.1'],
  [{ latest: '1.0.0-1', next: '1.0.0-alpha' }, '1.0.0-alpha'],
  [{ latest: '1.0.0-alpha', next: '1.0.0-alpha.1' }, '1.0.0-alpha.1'],
  [{ latest: '1.0.0', experimental: '99.0.0' }, '1.0.0'],
])('orders published SemVer candidates correctly: %j', async (tags, expected) => {
  const { resolvePublishedConsumer } = await import('../package/consumer-host.js')
  expect(await resolvePublishedConsumer(['pkg'], async () => tags as Record<string, string>)).toEqual({ pkg: expected })
})

it('completes required peer dependencies recursively and loads their real ESM imports', async () => {
  const { expandConsumerPeers } = await import('../package/consumer-host.js')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  const root = await mkdtemp(join(tmpdir(), 'consumer-peer-import-'))
  const manifests = {
    '@fixture/directory': { name: '@fixture/directory', version: '1.0.0', peerDependencies: { '@fixture/error': '*', '@fixture/optional': '*' }, peerDependenciesMeta: { '@fixture/optional': { optional: true } } },
    '@fixture/error': { name: '@fixture/error', version: '2.0.0', peerDependencies: { '@fixture/brand': '*' } },
    '@fixture/brand': { name: '@fixture/brand', version: '3.0.0', peerDependencies: { '@fixture/directory': '*' } },
  }
  const sources = {
    '@fixture/directory': "export { marker } from '@fixture/error'",
    '@fixture/error': "export { marker } from '@fixture/brand'",
    '@fixture/brand': "export const marker = 'peer graph loaded'",
  }
  type Name = keyof typeof manifests
  const install = async (name: Name) => {
    const directory = join(root, 'node_modules', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ ...manifests[name], type: 'module', exports: './index.js' }))
    await writeFile(join(directory, 'index.js'), sources[name])
  }
  try {
    await install('@fixture/directory')
    const run = () => exec(process.execPath, ['--input-type=module', '-e', "import { marker } from '@fixture/directory'; console.log(marker)"], { cwd: root })
    // Reproduce CI's failure with the incomplete seed list before expanding peers.
    await expect(run()).rejects.toMatchObject({ stderr: expect.stringContaining('ERR_MODULE_NOT_FOUND') })
    const reads: string[] = []
    const versions = await expandConsumerPeers({ '@fixture/directory': manifests['@fixture/directory'].version }, async name => {
      reads.push(name)
      return manifests[name as Name]
    }, async names => Object.fromEntries(names.map(name => [name, manifests[name as Name].version])))
    expect(Object.keys(versions).sort()).toEqual(Object.keys(manifests).sort())
    expect(reads).toHaveLength(3) // Cycles do not repeat metadata reads.
    for (const name of Object.keys(versions) as Name[]) await install(name)
    expect((await run()).stdout.trim()).toBe('peer graph loaded')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('fails on unresolved peers and never seeds the bundled LSP packages', async () => {
  const { expandConsumerPeers } = await import('../package/consumer-host.js')
  const manifest = { name: 'host', version: '1.0.0', peerDependencies: { missing: '*' } }
  await expect(expandConsumerPeers({ host: '1.0.0' }, async () => manifest, async () => ({}))).rejects.toThrow('Required consumer peer was not resolved')
  await expect(expandConsumerPeers({ host: '1.0.0' }, async () => ({ ...manifest, peerDependencies: { '@deepseek-ai/dsh-lsp': '*' } }), async () => ({}))).rejects.toThrow("must not mask the bundle's own dependencies")
  await expect(expandConsumerPeers({ host: '1.0.0' }, async () => ({ ...manifest, version: '2.0.0' }), async () => ({}))).rejects.toThrow('identity mismatch')
})
