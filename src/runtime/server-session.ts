import type { ChildProcess } from 'node:child_process'
import type { InitializeParams, InitializeResult, JsonRpcConnectionOptions } from '../protocol/types.js'
import { initializeServer } from '../protocol/initialize.js'
import { defaultServerRequest } from '../protocol/capabilities.js'
import { JsonRpcConnection } from './connection.js'
import { terminateProcess, type ShutdownOptions, StderrTail } from './process-lifecycle.js'

export type SessionState = 'NEW' | 'STARTING' | 'READY' | 'STOPPING' | 'STOPPED' | 'FAILED'

export interface ServerSessionOptions {
  spawn(): ChildProcess
  initialize: InitializeParams
  maxMessageBytes: number
  maxStderrBytes: number
  shutdown: ShutdownOptions
  onNotification?: JsonRpcConnectionOptions['onNotification']
}

export class ServerSession {
  state: SessionState = 'NEW'
  capabilities: Record<string, unknown> = {}
  restarts = 0
  readonly stderr: StderrTail
  private child: ChildProcess | undefined
  private connection: JsonRpcConnection | undefined
  private operation: Promise<void> = Promise.resolve()

  constructor(private readonly options: ServerSessionOptions) {
    this.stderr = new StderrTail(options.maxStderrBytes)
  }

  async start(signal?: AbortSignal): Promise<InitializeResult> {
    if (this.state === 'READY' && this.connection) return { capabilities: this.capabilities }
    if (this.state === 'STOPPING' || this.state === 'STOPPED') throw new Error('session is stopped')
    if (this.state === 'STARTING') throw new Error('session is already starting')
    this.state = 'STARTING'
    try {
      const child = this.options.spawn()
      if (!child.stdout || !child.stdin || !child.stderr) throw new Error('server stdio is unavailable')
      this.child = child
      child.stderr.on('data', (chunk: Buffer) => this.stderr.append(chunk))
      child.once('error', () => { if (this.state === 'READY') this.state = 'FAILED' })
      child.once('close', () => { if (this.state !== 'STOPPING' && this.state !== 'STOPPED') this.state = 'FAILED' })
      const connection = new JsonRpcConnection(child.stdout, child.stdin, {
        maxMessageBytes: this.options.maxMessageBytes,
        ...(this.options.onNotification === undefined ? {} : { onNotification: this.options.onNotification }),
        onServerRequest: defaultServerRequest,
      })
      this.connection = connection
      const result = await initializeServer(connection, this.options.initialize, signal)
      this.capabilities = { ...result.capabilities }
      this.state = 'READY'
      return result
    } catch (error) {
      this.state = 'FAILED'
      await this.stop().catch(() => {})
      throw error
    }
  }

  async run<T>(task: (connection: JsonRpcConnection) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.operation
    let release!: () => void
    this.operation = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      if (this.state !== 'READY' || !this.connection) throw new Error('session is not ready')
      return await task(this.connection)
    } finally {
      release()
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'STOPPED') return
    this.state = 'STOPPING'
    this.connection?.close(new Error('session stopped'))
    if (this.child) await terminateProcess(this.child, this.options.shutdown)
    this.child = undefined
    this.connection = undefined
    this.state = 'STOPPED'
  }

  isUsable(): boolean {
    return this.state === 'READY' && this.connection !== undefined
  }
}
