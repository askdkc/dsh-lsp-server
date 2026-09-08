import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { InitializeParams, InitializeResult } from '../protocol/types.js'
import { initializeServer } from '../protocol/initialize.js'
import { JsonRpcConnection } from './connection.js'
import { withAbort, throwIfAborted } from './cancellation.js'

export type SessionState = 'NEW' | 'STARTING' | 'READY' | 'STOPPING' | 'STOPPED' | 'FAILED'
export interface ServerSessionOptions {
  spawn(): SubprocessHandle
  initialize: InitializeParams
  configuration: unknown
  maxMessageBytes: number
  shutdown: { shutdownMs: number; killGraceMs: number }
}

export class ServerSession {
  state: SessionState = 'NEW'
  capabilities: Record<string, unknown> = {}
  private child?: SubprocessHandle
  private connection?: JsonRpcConnection
  private stopping?: Promise<void>
  private readonly lifetime = new AbortController()
  constructor(private readonly options: ServerSessionOptions) {}

  async start(signal?: AbortSignal): Promise<InitializeResult> {
    throwIfAborted(signal)
    this.state = 'STARTING'
    try {
      const child = this.options.spawn()
      this.child = child
      // Observe failed spawn even when stdio could not be allocated.
      void child.done.catch(() => {})
      if (!child.stdout || !child.stdin) throw new Error('server stdio is unavailable')
      const connection = new JsonRpcConnection(child.stdout, child.stdin, {
        maxMessageBytes: this.options.maxMessageBytes,
        onServerRequest: (method, params) => this.answer(method, params),
      })
      this.connection = connection
      void child.done.then(() => connection.close(new Error('LSP process exited')), error => connection.close(error instanceof Error ? error : new Error('LSP spawn failed'))).then(() => {
        if (this.state !== 'STOPPING' && this.state !== 'STOPPED') this.state = 'FAILED'
      })
      const result = await initializeServer(connection, this.options.initialize, this.signal(signal))
      if (result.capabilities.positionEncoding && result.capabilities.positionEncoding !== 'utf-16') throw new Error('server requires unsupported position encoding')
      const sync = result.capabilities.textDocumentSync
      if (sync === undefined || sync === 0 || (typeof sync === 'object' && sync !== null && !(sync as { openClose?: boolean }).openClose)) throw new Error('server does not support document open/close')
      this.capabilities = result.capabilities
      await connection.notify('workspace/didChangeConfiguration', { settings: this.options.configuration })
      throwIfAborted(this.signal(signal))
      this.state = 'READY'
      return result
    } catch (error) {
      this.state = 'FAILED'
      await this.stop()
      throw error
    }
  }

  get usable(): boolean { return this.state === 'READY' && !!this.connection?.isOpen }
  isUsable(): boolean { return this.usable }
  async run<T>(task: (connection: JsonRpcConnection) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!this.usable || !this.connection) throw new Error('session is not ready')
    try { return await withAbort(task(this.connection), this.signal(signal)) }
    catch (error) {
      // Stop cancelled work before the next queued request can reuse this process.
      if (signal?.aborted || !this.connection.isOpen) await this.stop()
      throw error
    }
  }

  stop(): Promise<void> {
    return this.stopping ??= this.teardown()
  }
  private async teardown(): Promise<void> {
    this.state = 'STOPPING'
    this.lifetime.abort()
    const child = this.child, connection = this.connection
    const timeout = AbortSignal.timeout(this.options.shutdown.shutdownMs)
    if (connection?.isOpen) {
      try { await connection.request('shutdown', null, timeout); await connection.notify('exit') } catch {}
    }
    connection?.close(new Error('session stopped'))
    if (child) {
      child.terminate()
      if (!await child.waitForExit(AbortSignal.timeout(this.options.shutdown.killGraceMs + 1000))) throw new Error('language server process tree did not exit within the cleanup deadline')
    }
    this.state = 'STOPPED'
  }
  private signal(signal?: AbortSignal): AbortSignal { return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal }
  private answer(method: string, params: unknown): unknown {
    if (method === 'workspace/applyEdit') return { applied: false, failureReason: 'read-only provider' }
    if (method === 'workspace/workspaceFolders') return this.options.initialize.workspaceFolders ?? []
    if (method === 'workspace/configuration') {
      const items = (params as { items?: Array<{ section?: string }> } | undefined)?.items ?? []
      return items.map(item => {
        let value = this.options.configuration
        for (const key of item.section?.split('.') ?? []) {
          value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
        }
        return value ?? null
      })
    }
    return null
  }
}
