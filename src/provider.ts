import type { ResolvedConfig } from './config.js'
import { resolveConfig } from './config.js'
import { WebstackLspError } from './errors.js'
import type { LspPosition } from './service.js'

export const name = 'lsp-webstack-provider'
export const inject = ['fs', 'lsp', 'subprocess'] as const

export const OUTER_EXTENSION_MAP = {
  '.php': 'php',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.svelte': 'svelte',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.pcss': 'css',
} as const

export interface LspProviderQuery {
  filePath: string
  position: LspPosition
  operation: 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'
}

export interface LspQueryResult {
  locations?: unknown[]
  hover?: unknown | null
  degraded?: boolean
}

export interface CompositeRuntime {
  navigation(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>
  dispose?(): Promise<void>
}

export interface LspProvider {
  id: string
  extensionToLanguage: Record<string, string>
  query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>
}

export interface ProviderContext {
  lsp: {
    registerProvider(provider: LspProvider): void | (() => void)
  }
  webstackRuntime?: CompositeRuntime
}

class UnavailableRuntime implements CompositeRuntime {
  async navigation(): Promise<never> {
    throw new WebstackLspError('LSP_UNAVAILABLE', 'webstack runtime has not been installed')
  }

  async dispose(): Promise<void> {}
}

export function createCompositeProvider(runtime: CompositeRuntime, config: Pick<ResolvedConfig, 'providerId'> = { providerId: 'webstack' }): LspProvider {
  return {
    id: config.providerId,
    extensionToLanguage: { ...OUTER_EXTENSION_MAP },
    query: (request, signal) => runtime.navigation(request, signal),
  }
}

export async function apply(ctx: ProviderContext, config: unknown = {}): Promise<() => Promise<void>> {
  const resolved = resolveConfig(config)
  const runtime = ctx.webstackRuntime ?? new UnavailableRuntime()
  const provider = createCompositeProvider(runtime, resolved)
  const unregister = ctx.lsp.registerProvider(provider)
  return async () => {
    if (typeof unregister === 'function') unregister()
    await runtime.dispose?.()
  }
}
