import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { LaunchSpec } from './types.js'

const require = createRequire(import.meta.url)

export async function resolvePackageBinary(packageName: string, binName: string, cwd: string, args = ['--stdio']): Promise<LaunchSpec> {
  const packageJson = require.resolve(`${packageName}/package.json`)
  const metadata = JSON.parse(await readFile(packageJson, 'utf8')) as { bin?: string | Record<string, string> }
  const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[binName] ?? metadata.bin?.[packageName]
  if (!bin) throw new Error(`binary ${binName} is not declared by ${packageName}`)
  return { command: process.execPath, args: [resolve(dirname(packageJson), bin), ...args], cwd }
}
