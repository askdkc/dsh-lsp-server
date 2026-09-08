import type { LspProviderQuery, LspQueryResult } from '@deepseek-ai/dsh-lsp'
import type { SubprocessService } from '@deepseek-ai/dsh-subprocess'
import type { ResolvedConfig, ServerId } from '../config.js'
import { SERVER_IDS } from '../config.js'
import { readSource, type HostFileSystem, type HostSource } from '../host/dsh.js'
import { classifyFile } from '../routing/classifier.js'
import { routeFor, type Route } from '../routing/route-table.js'
import { hasTailwindCandidate } from '../routing/tailwind-candidate.js'
import { resolveLaunch, initializationOptions, serverConfiguration } from '../servers/launch.js'
import { ServerSession } from './server-session.js'
import { ServerPool } from './server-pool.js'
import { throwIfAborted, withAbort } from './cancellation.js'
import { WebstackLspError } from '../errors.js'
import { supportsOperation } from '../protocol/capabilities.js'
import { normalizeHover } from '../protocol/normalize-hover.js'
import { normalizeLocations } from '../protocol/normalize-location.js'
import { normalizeDiagnostics } from '../protocol/normalize-diagnostic.js'
import { normalizeCompletion } from '../protocol/normalize-completion.js'
import { mergeHover } from '../merge/hover.js'
import { mergeDiagnostics } from '../merge/diagnostics.js'
import { mergeCompletions } from '../merge/completion.js'
import type { CompletionRequest, CompletionResult, DiagnosticsRequest, DiagnosticsResult, LspPosition, WebstackLspStatus } from '../service.js'
import type { JsonRpcConnection } from './connection.js'

export type HostSubprocess = Pick<SubprocessService, 'spawn' | 'resolveExecutable'>
const methods = { hover: 'textDocument/hover', goToDefinition: 'textDocument/definition', findReferences: 'textDocument/references', goToImplementation: 'textDocument/implementation' } as const
const clientCapabilities = {
  general: { positionEncodings: ['utf-16'] },
  workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: false },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
    publishDiagnostics: { versionSupport: true }, diagnostic: {},
  },
}

export class WebstackLspRuntime {
  private readonly pool: ServerPool<ServerSession>
  private readonly workspaces = new Map<string, HostSource>()
  private readonly lifetime = new AbortController()
  private readonly live = new Map<ServerSession, ServerId>()
  private readonly starts = new Map<string, number>()
  private readonly restarts = new Map<ServerId, number>()
  constructor(private readonly config: ResolvedConfig, private readonly fs: HostFileSystem, private readonly subprocess: HostSubprocess) {
    this.pool = new ServerPool(async (rawId, key, signal) => {
      const id = rawId as ServerId, source = this.workspaces.get(key)!
      const spec = await resolveLaunch(id, config, source.workspace)
      let executable: string
      try { executable = await subprocess.resolveExecutable(spec.command, spec.env, signal) }
      catch { throwIfAborted(signal); throw new WebstackLspError('LSP_UNAVAILABLE', `${id} executable is unavailable; run dsh-lsp-webstack --json`) }
      const session = new ServerSession({
        spawn: () => subprocess.spawn({ argv: [executable, ...spec.args], cwd: source.workspace, env: spec.env, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: config.limits.maxStderrBytes } }, graceMs: config.timeouts.killGraceMs }),
        initialize: { processId: null, rootUri: source.workspaceUri, workspaceFolders: [{ uri: source.workspaceUri, name: 'workspace' }], capabilities: clientCapabilities, initializationOptions: initializationOptions(id, config) },
        configuration: serverConfiguration(id, config), maxMessageBytes: config.limits.maxMessageBytes,
        shutdown: { shutdownMs: config.timeouts.shutdownMs, killGraceMs: config.timeouts.killGraceMs },
      })
      const slot = `${id}\u0000${key}`
      if (this.starts.has(slot)) this.restarts.set(id, (this.restarts.get(id) ?? 0) + 1)
      this.starts.set(slot, (this.starts.get(slot) ?? 0) + 1)
      for (const [old] of this.live) if (old.state === 'STOPPED' || old.state === 'FAILED') this.live.delete(old)
      this.live.set(session, id)
      return session
    })
  }

  async navigation(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult> {
    const deadline = this.signal(request.operation === 'hover' ? this.config.timeouts.primaryHoverMs : this.config.timeouts.navigationMs, signal)
    const [source, route] = await this.prepare(request, deadline)
    this.validatePosition(source.text, request.position)
    const result = await this.document(route.primary.server, source, route.primary.languageId, deadline, async (session, connection) => {
      if (!supportsOperation(session.capabilities, request.operation)) throw new WebstackLspError('LSP_UNSUPPORTED_OPERATION', `${route.primary.server} does not support ${request.operation}`)
      return connection.request(methods[request.operation], { textDocument: { uri: source.uri }, position: request.position, ...(request.operation === 'findReferences' ? { context: { includeDeclaration: true } } : {}) }, deadline)
    })
    if (request.operation !== 'hover') return { kind: 'locations', locations: normalizeLocations(result), resolvedWorkspaceUri: source.workspaceUri }
    const primary = normalizeHover(result)
    if (primary === undefined) throw new WebstackLspError('LSP_MALFORMED_RESPONSE', 'invalid hover result')
    let auxiliary = null
    if (this.useTailwind(route, source, request.position)) {
      const auxSignal = this.signal(this.config.timeouts.auxiliaryHoverMs, signal)
      try {
        const value = await this.document('tailwind', source, route.auxiliary!.languageId, auxSignal, (_session, connection) => connection.request('textDocument/hover', { textDocument: { uri: source.uri }, position: request.position }, auxSignal))
        auxiliary = normalizeHover(value) ?? null
      } catch { throwIfAborted(signal); throwIfAborted(this.lifetime.signal) }
    }
    const hover = mergeHover(primary && { ...primary, server: route.primary.server }, auxiliary && { ...auxiliary, server: 'tailwind' })
    return { kind: 'hover', hover: hover ? { contents: hover.contents, ...(hover.range ? { range: hover.range } : {}) } : null }
  }

  async completion(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const deadline = this.signal(this.config.timeouts.completionMs, signal)
    const [source, route] = await this.prepare(request, deadline)
    this.validatePosition(source.text, request.position)
    const query = (id: ServerId, language: string) => this.document(id, source, language, deadline, (session, connection) => {
      if (!session.capabilities.completionProvider) throw new WebstackLspError('LSP_UNSUPPORTED_OPERATION', `${id} does not support completion`)
      return connection.request('textDocument/completion', { textDocument: { uri: source.uri }, position: request.position, context: { triggerKind: request.triggerKind ?? 1, ...(request.triggerCharacter ? { triggerCharacter: request.triggerCharacter } : {}) } }, deadline)
    }).then(value => {
      const prefix = source.text.split(/\r?\n/)[request.position.line]!.slice(0, request.position.character).match(/[\w$:@/!\[\]-]+$/)?.[0]?.toLowerCase() ?? ''
      // Servers such as Tailwind return the whole catalog; the client must rank the typed prefix before applying a result cap.
      return normalizeCompletion(value, id).sort((a, b) => Number((b.filterText ?? b.label).toLowerCase().startsWith(prefix)) - Number((a.filterText ?? a.label).toLowerCase().startsWith(prefix)))
    })
    const primary = await query(route.primary.server, route.primary.languageId)
    let auxiliary: typeof primary = []
    if (this.useTailwind(route, source, request.position)) {
      try { auxiliary = await query('tailwind', route.auxiliary!.languageId) } catch { throwIfAborted(signal); throwIfAborted(this.lifetime.signal) }
    }
    return mergeCompletions([primary, auxiliary], { maxCompletions: Number.MAX_SAFE_INTEGER, maxResultChars: Number.MAX_SAFE_INTEGER })
  }

  async diagnostics(request: DiagnosticsRequest, signal?: AbortSignal): Promise<DiagnosticsResult> {
    const deadline = this.signal(this.config.timeouts.diagnosticsMs, signal)
    const [source, route] = await this.prepare(request, deadline)
    const selected = [route.primary, ...(route.auxiliary && this.config.tailwind.enabled ? [route.auxiliary] : [])].filter(item => this.config.servers[item.server].enabled && (!request.servers || request.servers.includes(item.server)))
    if (!selected.length) throw new WebstackLspError('LSP_UNAVAILABLE', 'no selected diagnostic server supports this file')
    const omittedServers: string[] = []
    const groups = await Promise.all(selected.map(async item => {
      try {
        const value = await this.document(item.server, source, item.languageId, deadline, async (session, connection, opened) => {
          if (session.capabilities.diagnosticProvider) {
            await opened()
            const report = await connection.request('textDocument/diagnostic', { textDocument: { uri: source.uri } }, deadline) as { items?: unknown }
            return report?.items ?? []
          }
          // Subscribe before didOpen; do not confuse a missing publication with a clean file.
          let remove = () => {}
          const published = new Promise<unknown>(resolve => {
            remove = connection.onNotification(message => {
              const p = message.params as { uri?: string; diagnostics?: unknown; version?: number } | undefined
              if (message.method === 'textDocument/publishDiagnostics' && p?.uri === source.uri && (p.version === undefined || p.version === 1)) resolve(p.diagnostics)
            })
          })
          try { await opened(); return await withAbort(published, deadline) } finally { remove() }
        }, true)
        return normalizeDiagnostics(value, item.server, source.uri).filter(d => !request.severity || request.severity === 'all' || d.severity === (request.severity === 'error' ? 1 : 2))
      } catch (error) {
        throwIfAborted(signal); throwIfAborted(this.lifetime.signal)
        if (item.server === route.primary.server || this.config.missingServerPolicy === 'error') throw error
        omittedServers.push(item.server)
        return []
      }
    }))
    return { ...mergeDiagnostics(groups, { maxDiagnostics: Number.MAX_SAFE_INTEGER, maxResultChars: Number.MAX_SAFE_INTEGER }), ...(omittedServers.length ? { omittedServers: omittedServers.sort() } : {}) }
  }

  async status(): Promise<WebstackLspStatus> {
    return { providerId: this.config.providerId, servers: await Promise.all(SERVER_IDS.map(async id => {
      const config = this.config.servers[id]
      let available = false
      try {
        const launch = await resolveLaunch(id, this.config, '.')
        await this.subprocess.resolveExecutable(launch.command, launch.env, this.signal(5000))
        available = true
      } catch {}
      return { id, enabled: config.enabled && (id !== 'tailwind' || this.config.tailwind.enabled), available, source: config.mode, liveWorkspaces: [...this.live].filter(([s, server]) => server === id && s.isUsable()).length, restarts: this.restarts.get(id) ?? 0 }
    })) }
  }

  async dispose(): Promise<void> { this.lifetime.abort(); await this.pool.disposeAll(); this.workspaces.clear(); this.live.clear() }

  private signal(ms: number, signal?: AbortSignal): AbortSignal { return AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(ms), ...(signal ? [signal] : [])]) }
  private async prepare(request: { workspaceRoot: string; filePath: string }, signal: AbortSignal): Promise<[HostSource, Route]> {
    throwIfAborted(signal)
    const file = classifyFile(request.filePath, this.config.routing.bladeSuffixes)
    if (!file) throw new WebstackLspError('LSP_UNAVAILABLE', 'unsupported file extension')
    const source = await readSource(this.fs, request.workspaceRoot, request.filePath, this.config.limits.maxDocumentBytes, signal).catch(error => { throwIfAborted(signal); throw error })
    this.workspaces.set(source.key, { ...source, text: '' })
    return [source, routeFor(file)]
  }
  private validatePosition(text: string, position: LspPosition): void {
    const line = text.split(/\r?\n/)[position.line]
    if (!Number.isSafeInteger(position.line) || !Number.isSafeInteger(position.character) || position.line < 0 || position.character < 0 || line === undefined || position.character > line.length) throw new RangeError('position is outside document (zero-based UTF-16 required)')
  }
  private useTailwind(route: Route, source: HostSource, position: LspPosition): boolean {
    return !!route.auxiliary && this.config.tailwind.enabled && this.config.servers.tailwind.enabled && (route.primary.languageId === 'blade' || this.config.routing.tailwindLanguages.includes(route.primary.languageId) || route.primary.languageId === 'css') && (this.config.tailwind.queryStrategy === 'always' || hasTailwindCandidate(source.text, position.line, this.config.tailwind.classRegex, position.character, this.config.tailwind.classAttributes))
  }
  private async document<T>(id: ServerId, source: HostSource, language: string, signal: AbortSignal, task: (session: ServerSession, connection: JsonRpcConnection, open: () => Promise<void>) => Promise<T>, manualOpen = false): Promise<T> {
    if (!this.config.servers[id].enabled) throw new WebstackLspError('LSP_UNAVAILABLE', `${id} is disabled`)
    return this.pool.runWithRetry(id, source.key, session => session.run(async connection => {
      let opened = false
      const open = async () => { opened = true; await connection.notify('textDocument/didOpen', { textDocument: { uri: source.uri, languageId: language, version: 1, text: source.text } }) }
      try { if (!manualOpen) await open(); return await task(session, connection, open) }
      finally { if (opened && connection.isOpen) await connection.notify('textDocument/didClose', { textDocument: { uri: source.uri } }).catch(() => {}) }
    }, signal), signal, manualOpen ? session => {
      // Push notifications can omit document versions. A delayed didClose clear
      // from a previous operation is indistinguishable from a fresh clean result.
      // Use a fresh process for push diagnostics; pull responses have request IDs.
      return !!session.capabilities.diagnosticProvider
    } : undefined)
  }
}
