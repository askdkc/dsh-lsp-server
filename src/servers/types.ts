import type { ClassifiedFile } from '../routing/classifier.js'
import type { ResolvedConfig } from '../config.js'

export interface LaunchSpec {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface ConfigurationItem { section?: string; scopeUri?: string | null }

export interface ServerInfo { id: string; version?: string }

export interface ServerAdapter {
  readonly id: string
  readonly role: 'primary' | 'auxiliary' | 'both'
  resolveLaunch(config: ResolvedConfig, workspace: string): Promise<LaunchSpec>
  languageId(file: ClassifiedFile): string | null
  supportsFile(file: ClassifiedFile): boolean
  configuration(items: ConfigurationItem[]): unknown[]
  initializationOptions(workspace: string): unknown
  normalizeServerInfo(value: unknown): ServerInfo | undefined
}
