import { createRequire } from 'node:module'
import type { ResolvedConfig, ServerId } from '../config.js'
import { resolvePackageBinary } from './package-bin.js'
import type { LaunchSpec } from './types.js'

const packages: Record<Exclude<ServerId, 'phpantom'>, [string, string]> = {
  typescript: ['typescript-language-server', 'typescript-language-server'],
  svelte: ['svelte-language-server', 'svelteserver'],
  html: ['vscode-langservers-extracted', 'vscode-html-language-server'],
  css: ['vscode-langservers-extracted', 'vscode-css-language-server'],
  tailwind: ['@tailwindcss/language-server', 'tailwindcss-language-server'],
}

export async function resolveLaunch(id: ServerId, config: ResolvedConfig, workspace: string): Promise<LaunchSpec> {
  const server = config.servers[id]
  if (server.mode === 'path' || id === 'phpantom') return { command: server.command, args: [...server.args], cwd: workspace, env: { ...server.env } }
  const [pkg, bin] = packages[id]
  return { ...await resolvePackageBinary(pkg, bin, workspace, server.args), env: { ...server.env } }
}

export function initializationOptions(id: ServerId, config: ResolvedConfig): unknown {
  const configured = config.servers[id].initializationOptions
  if (configured !== undefined) return configured
  if (id === 'typescript' && config.servers[id].mode === 'bundled') {
    return { tsserver: { path: createRequire(import.meta.url).resolve('typescript/lib/tsserver.js') } }
  }
  if (id === 'tailwind') return { userLanguages: config.tailwind.includeLanguages }
  return null
}

export function serverConfiguration(id: ServerId, config: ResolvedConfig): unknown {
  if (config.servers[id].configuration !== undefined) return config.servers[id].configuration
  if (id === 'tailwind') return { tailwindCSS: { classAttributes: config.tailwind.classAttributes, includeLanguages: config.tailwind.includeLanguages, experimental: { classRegex: config.tailwind.classRegex } } }
  return {}
}
