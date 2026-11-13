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
  expect(await resolvePublishedConsumer(['a', 'b'], lookup)).toEqual({ a: tags.a!.latest, b: tags.b!.next })
  expect(await resolvePublishedConsumer(['a'], lookup, { a: 'next' })).toEqual({ a: tags.a!.next })
  await expect(resolvePublishedConsumer(['a'], lookup, { a: 'alpha' })).rejects.toThrow('No published consumer version')
  await expect(resolvePublishedConsumer(['a'], lookup, { a: '1.2.3' })).rejects.toThrow('Invalid consumer tag')
})
