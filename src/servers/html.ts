import { resolvePackageBinary } from './package-bin.js'
import type { ClassifiedFile } from '../routing/classifier.js'
import type { ResolvedConfig } from '../config.js'
import type { ServerAdapter, LaunchSpec, ConfigurationItem, ServerInfo } from './types.js'

export const htmlAdapter: ServerAdapter = {
  id: 'html', role: 'primary',
  resolveLaunch: (config: ResolvedConfig, workspace: string) => resolvePackageBinary('vscode-langservers-extracted', 'vscode-html-language-server', workspace, config.servers.html.args),
  languageId: (file: ClassifiedFile) => file.kind === 'html' ? 'html' : null,
  supportsFile: (file) => file.kind === 'html',
  configuration: (items: ConfigurationItem[]) => items.map(() => null),
  initializationOptions: () => ({}),
  normalizeServerInfo: () => ({ id: 'html' }),
}
