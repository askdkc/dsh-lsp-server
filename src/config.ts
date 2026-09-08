import { configError } from './errors.js'

export type ServerId = 'phpantom' | 'typescript' | 'svelte' | 'html' | 'css' | 'tailwind'
export type ServerMode = 'bundled' | 'path'

export interface ServerConfig {
  enabled?: boolean
  mode?: ServerMode
  command?: string
  args?: string[]
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
}

export interface Config {
  providerId?: string
  missingServerPolicy?: 'warn' | 'error'
  limits?: {
    maxDocumentBytes?: number
    maxMessageBytes?: number
    maxStderrBytes?: number
  }
  timeouts?: {
    navigationMs?: number
    primaryHoverMs?: number
    auxiliaryHoverMs?: number
    diagnosticsMs?: number
    completionMs?: number
    shutdownMs?: number
    killGraceMs?: number
  }
  servers?: Partial<Record<ServerId, ServerConfig>>
  tailwind?: {
    enabled?: boolean
    queryStrategy?: 'candidate' | 'always'
    classAttributes?: string[]
    classRegex?: Array<string | [string, string]>
    includeLanguages?: Record<string, string>
  }
  routing?: {
    bladeSuffixes?: string[]
    tailwindLanguages?: string[]
  }
}

export interface ResolvedServerConfig {
  enabled: boolean
  mode: ServerMode
  command: string
  args: string[]
  env: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
}

export interface ResolvedConfig {
  providerId: string
  missingServerPolicy: 'warn' | 'error'
  limits: {
    maxDocumentBytes: number
    maxMessageBytes: number
    maxStderrBytes: number
  }
  timeouts: {
    navigationMs: number
    primaryHoverMs: number
    auxiliaryHoverMs: number
    diagnosticsMs: number
    completionMs: number
    shutdownMs: number
    killGraceMs: number
  }
  servers: Record<ServerId, ResolvedServerConfig>
  tailwind: {
    enabled: boolean
    queryStrategy: 'candidate' | 'always'
    classAttributes: string[]
    classRegex: Array<string | [string, string]>
    includeLanguages: Record<string, string>
  }
  routing: {
    bladeSuffixes: string[]
    tailwindLanguages: string[]
  }
}

const SERVER_COMMANDS: Record<ServerId, string> = {
  phpantom: 'phpantom_lsp',
  typescript: 'typescript-language-server',
  svelte: 'svelteserver',
  html: 'vscode-html-language-server',
  css: 'vscode-css-language-server',
  tailwind: 'tailwindcss-language-server',
}

const DEFAULT_SERVER_MODES: Record<ServerId, ServerMode> = {
  phpantom: 'path',
  typescript: 'bundled',
  svelte: 'bundled',
  html: 'bundled',
  css: 'bundled',
  tailwind: 'bundled',
}

export const SERVER_IDS: ServerId[] = ['phpantom', 'typescript', 'svelte', 'html', 'css', 'tailwind']
const DEFAULT_LIMITS = { maxDocumentBytes: 1_048_576, maxMessageBytes: 8_388_608, maxStderrBytes: 65_536 }
const DEFAULT_TIMEOUTS = { navigationMs: 60_000, primaryHoverMs: 30_000, auxiliaryHoverMs: 8_000, diagnosticsMs: 60_000, completionMs: 15_000, shutdownMs: 5_000, killGraceMs: 1_000 }

export const DEFAULT_CONFIG: ResolvedConfig = {
  providerId: 'webstack',
  missingServerPolicy: 'warn',
  limits: { ...DEFAULT_LIMITS },
  timeouts: { ...DEFAULT_TIMEOUTS },
  servers: Object.fromEntries(SERVER_IDS.map((id) => [id, {
    enabled: true,
    mode: DEFAULT_SERVER_MODES[id],
    command: SERVER_COMMANDS[id],
    args: ['--stdio'],
    env: {},
  }])) as Record<ServerId, ResolvedServerConfig>,
  tailwind: { enabled: true, queryStrategy: 'candidate', classAttributes: ['class', 'className', 'class:list'], classRegex: [], includeLanguages: {} },
  routing: { bladeSuffixes: ['.blade.php'], tailwindLanguages: ['html', 'svelte', 'typescript', 'typescriptreact', 'javascript', 'javascriptreact'] },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPositiveInteger(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw configError(`${label} must be a positive integer no greater than 2147483647`)
  return value
}

function readBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw configError(`${label} must be a boolean`)
  return value
}

function readString(value: unknown, label: string, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) throw configError(`${label} must be a non-empty string without NUL`)
  return value
}

function cloneJson(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, label))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item, label)]))
  throw configError(`${label} must contain JSON-compatible values`)
}

function resolveSuffixes(value: unknown, label: string, fallback: string[]): string[] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.length === 0) throw configError(`${label} must be a non-empty array`)
  const normalized = value.map((suffix, index) => {
    if (typeof suffix !== 'string' || suffix.length === 0 || suffix.includes('/') || suffix.includes('\\')) throw configError(`${label}[${index}] is not a valid suffix`)
    return suffix.toLowerCase()
  })
  if (new Set(normalized).size !== normalized.length) throw configError(`${label} contains duplicate suffixes`)
  return normalized
}

function resolveStringArray(value: unknown, label: string, fallback: string[]): string[] {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw configError(`${label} must be an array of strings`)
  return [...value]
}

function resolveEnv(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value) || Object.entries(value).some(([key, item]) => key.length === 0 || typeof item !== 'string')) throw configError(`${label} must be a string map`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item as string]))
}

function resolveServer(id: ServerId, value: unknown): ResolvedServerConfig {
  if (value !== undefined && !isRecord(value)) throw configError(`servers.${id} must be an object`)
  const input = value as Record<string, unknown> | undefined
  const mode = input?.mode === undefined ? DEFAULT_SERVER_MODES[id] : input.mode
  if (mode !== 'bundled' && mode !== 'path') throw configError(`servers.${id}.mode must be bundled or path`)
  if (id === 'phpantom' && mode === 'bundled') throw configError('PHPantom must use path mode')
  const command = input?.command === undefined ? SERVER_COMMANDS[id] : readString(input.command, `servers.${id}.command`, SERVER_COMMANDS[id])
  if (mode === 'path' && input?.command === undefined && id !== 'phpantom') throw configError(`servers.${id}.command is required in path mode`)
  const argsValue = input?.args
  if (argsValue !== undefined && (!Array.isArray(argsValue) || argsValue.some((item) => typeof item !== 'string'))) throw configError(`servers.${id}.args must be an array of strings`)
  return {
    enabled: readBoolean(input?.enabled, `servers.${id}.enabled`, true),
    mode,
    command,
    args: argsValue === undefined ? ['--stdio'] : [...argsValue] as string[],
    env: resolveEnv(input?.env, `servers.${id}.env`),
    ...(input?.initializationOptions === undefined ? {} : { initializationOptions: cloneJson(input.initializationOptions, `servers.${id}.initializationOptions`) }),
    ...(input?.configuration === undefined ? {} : { configuration: cloneJson(input.configuration, `servers.${id}.configuration`) }),
  }
}

export function resolveConfig(input: unknown = {}): ResolvedConfig {
  if (!isRecord(input)) throw configError('config must be an object')
  const limits = isRecord(input.limits) ? input.limits : input.limits === undefined ? {} : (() => { throw configError('limits must be an object') })()
  const timeouts = isRecord(input.timeouts) ? input.timeouts : input.timeouts === undefined ? {} : (() => { throw configError('timeouts must be an object') })()
  const tailwind = isRecord(input.tailwind) ? input.tailwind : input.tailwind === undefined ? {} : (() => { throw configError('tailwind must be an object') })()
  const routing = isRecord(input.routing) ? input.routing : input.routing === undefined ? {} : (() => { throw configError('routing must be an object') })()
  const serverInput = isRecord(input.servers) ? input.servers : input.servers === undefined ? {} : (() => { throw configError('servers must be an object') })()
  const providerId = readString(input.providerId, 'providerId', DEFAULT_CONFIG.providerId)
  const missingServerPolicy = input.missingServerPolicy === undefined ? 'warn' : input.missingServerPolicy
  if (missingServerPolicy !== 'warn' && missingServerPolicy !== 'error') throw configError('missingServerPolicy must be warn or error')
  const classRegex = tailwind.classRegex
  if (classRegex !== undefined && (!Array.isArray(classRegex) || classRegex.some((item) => typeof item !== 'string' && (!Array.isArray(item) || item.length !== 2 || item.some((part) => typeof part !== 'string'))))) throw configError('tailwind.classRegex must contain strings or string pairs')
  const queryStrategy = tailwind.queryStrategy === undefined ? 'candidate' : tailwind.queryStrategy
  for (const expression of (classRegex ?? []) as Array<string | [string, string]>) {
    for (const pattern of Array.isArray(expression) ? expression : [expression]) {
      try { new RegExp(pattern) } catch { throw configError('tailwind.classRegex contains an invalid regular expression') }
    }
  }
  if (queryStrategy !== 'candidate' && queryStrategy !== 'always') throw configError('tailwind.queryStrategy must be candidate or always')
  const includeLanguages = resolveEnv(tailwind.includeLanguages, 'tailwind.includeLanguages')
  return {
    providerId,
    missingServerPolicy,
    limits: {
      maxDocumentBytes: readPositiveInteger(limits.maxDocumentBytes, 'limits.maxDocumentBytes', DEFAULT_LIMITS.maxDocumentBytes),
      maxMessageBytes: readPositiveInteger(limits.maxMessageBytes, 'limits.maxMessageBytes', DEFAULT_LIMITS.maxMessageBytes),
      maxStderrBytes: readPositiveInteger(limits.maxStderrBytes, 'limits.maxStderrBytes', DEFAULT_LIMITS.maxStderrBytes),
    },
    timeouts: {
      navigationMs: readPositiveInteger(timeouts.navigationMs, 'timeouts.navigationMs', DEFAULT_TIMEOUTS.navigationMs),
      primaryHoverMs: readPositiveInteger(timeouts.primaryHoverMs, 'timeouts.primaryHoverMs', DEFAULT_TIMEOUTS.primaryHoverMs),
      auxiliaryHoverMs: readPositiveInteger(timeouts.auxiliaryHoverMs, 'timeouts.auxiliaryHoverMs', DEFAULT_TIMEOUTS.auxiliaryHoverMs),
      diagnosticsMs: readPositiveInteger(timeouts.diagnosticsMs, 'timeouts.diagnosticsMs', DEFAULT_TIMEOUTS.diagnosticsMs),
      completionMs: readPositiveInteger(timeouts.completionMs, 'timeouts.completionMs', DEFAULT_TIMEOUTS.completionMs),
      shutdownMs: readPositiveInteger(timeouts.shutdownMs, 'timeouts.shutdownMs', DEFAULT_TIMEOUTS.shutdownMs),
      killGraceMs: readPositiveInteger(timeouts.killGraceMs, 'timeouts.killGraceMs', DEFAULT_TIMEOUTS.killGraceMs),
    },
    servers: Object.fromEntries(SERVER_IDS.map((id) => [id, resolveServer(id, serverInput[id])])) as Record<ServerId, ResolvedServerConfig>,
    tailwind: {
      enabled: readBoolean(tailwind.enabled, 'tailwind.enabled', true),
      queryStrategy,
      classAttributes: resolveStringArray(tailwind.classAttributes, 'tailwind.classAttributes', DEFAULT_CONFIG.tailwind.classAttributes),
      classRegex: classRegex === undefined ? [] : (classRegex.map((item) => Array.isArray(item) ? [...item] as [string, string] : item)),
      includeLanguages,
    },
    routing: {
      bladeSuffixes: resolveSuffixes(routing.bladeSuffixes, 'routing.bladeSuffixes', DEFAULT_CONFIG.routing.bladeSuffixes),
      tailwindLanguages: resolveStringArray(routing.tailwindLanguages, 'routing.tailwindLanguages', DEFAULT_CONFIG.routing.tailwindLanguages),
    },
  }
}

if (DEFAULT_CONFIG.tailwind.queryStrategy !== 'candidate' && DEFAULT_CONFIG.tailwind.queryStrategy !== 'always') throw new Error('invalid internal default')

export const ConfigSchema = {
  parse: resolveConfig,
  validate: resolveConfig,
} as const
