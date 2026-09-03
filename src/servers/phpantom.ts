import type { ClassifiedFile } from '../routing/classifier.js'
import type { ResolvedConfig } from '../config.js'
import type { ServerAdapter, LaunchSpec, ConfigurationItem, ServerInfo } from './types.js'

export const phpantomAdapter: ServerAdapter = {
  id: 'phpantom', role: 'primary',
  async resolveLaunch(config: ResolvedConfig, workspace: string): Promise<LaunchSpec> { const server = config.servers.phpantom; return { command: server.command, args: [...server.args], cwd: workspace, ...(Object.keys(server.env).length ? { env: { ...server.env } } : {}) } },
  languageId: (file: ClassifiedFile) => file.kind === 'blade' ? 'blade' : file.kind === 'php' ? 'php' : null,
  supportsFile: (file) => file.kind === 'blade' || file.kind === 'php',
  configuration: (items: ConfigurationItem[]) => items.map(() => null),
  initializationOptions: () => undefined,
  normalizeServerInfo: (value: unknown) => normalizeInfo(value),
}
function normalizeInfo(value: unknown): ServerInfo | undefined {
  if (typeof value !== 'object' || value === null || typeof (value as { name?: unknown }).name !== 'string') return undefined
  const version = (value as { version?: unknown }).version
  return typeof version === 'string' ? { id: 'phpantom', version } : { id: 'phpantom' }
}
