import { resolvePackageBinary } from './package-bin.js'
import type { ClassifiedFile } from '../routing/classifier.js'
import type { ResolvedConfig } from '../config.js'
import type { ServerAdapter, LaunchSpec, ConfigurationItem, ServerInfo } from './types.js'

export const typescriptAdapter: ServerAdapter = {
  id: 'typescript', role: 'primary',
  resolveLaunch: (config: ResolvedConfig, workspace: string) => resolvePackageBinary('typescript-language-server', 'typescript-language-server', workspace, config.servers.typescript.args),
  languageId: (file: ClassifiedFile) => ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(file.kind) ? file.kind : null,
  supportsFile: (file) => ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(file.kind),
  configuration: (items: ConfigurationItem[]) => items.map(() => null),
  initializationOptions: () => ({}),
  normalizeServerInfo: (value: unknown) => normalizeInfo(value),
}
function normalizeInfo(value: unknown): ServerInfo | undefined {
  if (typeof value !== 'object' || value === null || typeof (value as { name?: unknown }).name !== 'string') return undefined
  const version = (value as { version?: unknown }).version
  return typeof version === 'string' ? { id: 'typescript', version } : { id: 'typescript' }
}
