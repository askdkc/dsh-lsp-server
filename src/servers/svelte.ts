import { resolvePackageBinary } from './package-bin.js'
import type { ClassifiedFile } from '../routing/classifier.js'
import type { ResolvedConfig } from '../config.js'
import type { ServerAdapter, LaunchSpec, ConfigurationItem, ServerInfo } from './types.js'

export const svelteAdapter: ServerAdapter = {
  id: 'svelte', role: 'primary',
  resolveLaunch: (config: ResolvedConfig, workspace: string) => resolvePackageBinary('svelte-language-server', 'svelteserver', workspace, config.servers.svelte.args),
  languageId: (file: ClassifiedFile) => file.kind === 'svelte' ? 'svelte' : null,
  supportsFile: (file) => file.kind === 'svelte',
  configuration: (items: ConfigurationItem[]) => items.map(() => null),
  initializationOptions: () => ({}),
  normalizeServerInfo: () => ({ id: 'svelte' }),
}
