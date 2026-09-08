import type { Context } from '@deepseek-ai/cordis'
import { LspProviderId } from '@deepseek-ai/dsh-lsp'
import type { LspProvider, LspProviderQuery, LspQueryResult } from '@deepseek-ai/dsh-lsp'
import type { Config as PluginConfig, ResolvedConfig } from './config.js'
import { resolveConfig } from './config.js'
import type { WebstackLspService } from './service.js'
import { createWebstackLspService } from './service.js'
import { WebstackLspRuntime } from './runtime/webstack-runtime.js'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'

export type { LspProvider, LspProviderQuery, LspQueryResult }
export type Config = PluginConfig
export const name = 'lsp-webstack-provider'
export const inject = ['fs', 'lsp', 'subprocess']

declare module '@deepseek-ai/cordis' {
  interface Context { webstackLsp: WebstackLspService }
}

export const OUTER_EXTENSION_MAP = {
  '.php': 'php', '.ts': 'typescript', '.tsx': 'typescriptreact', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript',
  '.svelte': 'svelte', '.html': 'html', '.htm': 'html', '.css': 'css', '.pcss': 'css',
} as const

export interface CompositeRuntime {
  navigation(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>
  dispose?(): Promise<void>
}

export function createCompositeProvider(runtime: CompositeRuntime, config: Pick<ResolvedConfig, 'providerId'> = { providerId: 'webstack' }): LspProvider {
  return { id: LspProviderId(config.providerId), extensionToLanguage: { ...OUTER_EXTENSION_MAP }, query: (request, signal) => runtime.navigation(request, signal) }
}

export async function apply(ctx: Context, config: unknown = {}): Promise<void> {
  const resolved = resolveConfig(config)
  const runtime = new WebstackLspRuntime(resolved, ctx.fs, ctx.subprocess)
  await ctx.effect(async function* () {
    yield () => runtime.dispose()
    if (resolved.missingServerPolicy === 'error') {
      const missing = (await runtime.status()).servers.filter(server => server.enabled && !server.available)
      if (missing.length) throw new Error(`unavailable language servers: ${missing.map(server => server.id).join(', ')}`)
    }
    yield ctx.lsp.registerProvider(createCompositeProvider(runtime, resolved))
    yield ctx.provide('webstackLsp', createWebstackLspService(runtime))
  }, 'webstack LSP provider')
}
