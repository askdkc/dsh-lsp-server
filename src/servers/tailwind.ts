import { resolvePackageBinary } from './package-bin.js'
import type { ClassifiedFile } from '../routing/classifier.js'
import type { ResolvedConfig } from '../config.js'
import type { ServerAdapter, LaunchSpec, ConfigurationItem, ServerInfo } from './types.js'

export const tailwindAdapter: ServerAdapter = {
  id: 'tailwind', role: 'both',
  resolveLaunch: (config: ResolvedConfig, workspace: string) => resolvePackageBinary('@tailwindcss/language-server', 'tailwindcss-language-server', workspace, config.servers.tailwind.args),
  languageId: (file: ClassifiedFile) => file.kind === 'css' ? 'css' : file.kind === 'blade' || file.kind === 'html' || file.kind === 'svelte' || file.kind === 'typescriptreact' || file.kind === 'javascriptreact' ? (file.kind === 'blade' ? 'html' : file.kind) : null,
  supportsFile: (file) => file.kind !== 'php',
  configuration: (items: ConfigurationItem[]) => items.map(() => null),
  initializationOptions: () => ({}),
  normalizeServerInfo: () => ({ id: 'tailwind' }),
}
