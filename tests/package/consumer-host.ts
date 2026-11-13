import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Resolve each package from the installed host, including hoisted parent modules.
 * Never infer a sibling version from one DSH package's version or dist-tag.
 */
export async function resolveConsumerHost(root: string, names: string[]): Promise<Record<string, string>> {
  const require = createRequire(join(resolve(root), 'package.json'))
  const versions: Record<string, string> = {}
  for (const name of names) {
    let path: string
    try { path = require.resolve(`${name}/package.json`) }
    catch {
      // Some packages export their entry but not their manifest.
      try {
        let directory = dirname(require.resolve(name))
        while (true) {
          const candidate = join(directory, 'package.json')
          const manifest = await readFile(candidate, 'utf8').then(JSON.parse).catch(() => undefined)
          if (manifest?.name === name) { path = candidate; break }
          const parent = dirname(directory)
          if (parent === directory) throw new Error('manifest not found')
          directory = parent
        }
      } catch { throw new Error(`Current DSH consumer is missing ${name} under ${root}; supply a complete installed host with DSH_CONSUMER_ROOT (no version substitution is performed). Resolved packages: ${JSON.stringify(versions)}`) }
    }
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    if (manifest.name !== name || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(manifest.version)) throw new Error(`Invalid installed manifest for ${name}: ${path}`)
    versions[name] = manifest.version
  }
  return versions
}

/** Moving consumer: resolve tags per package, then pin only the resulting test lock. */
export async function resolvePublishedConsumer(
  names: string[],
  lookup: (name: string) => Promise<Record<string, string>>,
  preferredTags: Record<string, string> = {},
): Promise<Record<string, string>> {
  if (!preferredTags || typeof preferredTags !== 'object' || Array.isArray(preferredTags)) throw new TypeError('DSH_CONSUMER_TAGS must be a package-to-tag object')
  for (const [name, tag] of Object.entries(preferredTags)) {
    if (!names.includes(name) || typeof tag !== 'string' || !/^[a-zA-Z][\w.-]*$/.test(tag)) throw new TypeError(`Invalid consumer tag override: ${name}`)
  }
  const versions: Record<string, string> = {}
  // Bounded concurrency avoids spawning a package-manager process for every package at once.
  for (let offset = 0; offset < names.length; offset += 4) {
    await Promise.all(names.slice(offset, offset + 4).map(async name => {
      const tags = await lookup(name)
      // npm's latest is a mutable channel label, not the highest published version.
      // DSH packages can leave it pointing at an old API while rc/next advance.
      const candidates = ['latest', 'next', 'rc', 'beta', 'alpha'].filter(tag => tags[tag])
      const tag = preferredTags[name] ?? candidates.sort((a, b) => compareVersions(tags[b]!, tags[a]!))[0]
      const version = tag && tags[tag]
      if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) throw new Error(`No published consumer version for ${name} (${tag ?? 'no supported tag'})`)
      compareVersions(version, version)
      versions[name] = version
    }))
  }
  return versions
}

/** SemVer precedence; build metadata does not affect ordering. */
function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value)
    if (!match) throw new Error(`Invalid published version: ${value}`)
    const pre = match[4]?.split('.')
    if (pre?.some(part => /^0\d+$/.test(part))) throw new Error(`Invalid published version: ${value}`)
    return { core: match.slice(1, 4).map(BigInt), pre }
  }
  const a = parse(left), b = parse(right)
  for (let index = 0; index < 3; index++) {
    if (a.core[index]! < b.core[index]!) return -1
    if (a.core[index]! > b.core[index]!) return 1
  }
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index], y = b.pre[index]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}
