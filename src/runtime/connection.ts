import type { Readable, Writable } from 'node:stream'
import { abortError, onAbort, throwIfAborted } from './cancellation.js'
import { ContentLengthDecoder, encodeJsonRpc, JsonRpcFrameError } from './framing.js'
import type { JsonRpcConnectionOptions, JsonRpcId, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from '../protocol/types.js'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  method: string
}

export class JsonRpcConnection {
  private readonly decoder: ContentLengthDecoder
  private readonly pending = new Map<JsonRpcId, PendingRequest>()
  private readonly notificationListeners = new Set<(notification: JsonRpcNotification) => void>()
  private nextId = 1
  private closed = false
  private requestHandler: NonNullable<JsonRpcConnectionOptions['onServerRequest']>

  constructor(private readonly input: Readable, private readonly output: Writable, options: JsonRpcConnectionOptions) {
    this.decoder = new ContentLengthDecoder(options.maxMessageBytes)
    this.requestHandler = options.onServerRequest ?? (() => null)
    if (options.onNotification) this.notificationListeners.add(options.onNotification)
    input.on('data', (chunk: Buffer) => this.receive(chunk))
    input.once('end', () => this.close(new Error('LSP process closed stdout')))
    input.once('error', (error) => this.close(error))
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  setRequestHandler(handler: NonNullable<JsonRpcConnectionOptions['onServerRequest']>): void {
    this.requestHandler = handler
  }

  async request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    throwIfAborted(signal)
    if (this.closed) throw new Error('connection is closed')
    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject, method }))
    const remove = onAbort(signal, () => {
      this.notify('$/cancelRequest', { id })
      this.pending.get(id)?.reject(abortError())
      this.pending.delete(id)
    })
    try {
      await this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
      return await promise
    } finally {
      remove()
      this.pending.delete(id)
    }
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) throw new Error('connection is closed')
    await this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
  }

  close(reason = new Error('connection closed')): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) pending.reject(reason)
    this.pending.clear()
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return
    let messages: unknown[]
    try {
      messages = this.decoder.feed(chunk)
    } catch (error) {
      this.close(error instanceof Error ? error : new JsonRpcFrameError('invalid frame'))
      return
    }
    for (const message of messages) this.dispatch(message)
  }

  private dispatch(value: unknown): void {
    if (!isRecord(value) || value.jsonrpc !== '2.0') return this.close(new JsonRpcFrameError('invalid JSON-RPC message'))
    if ('method' in value && typeof value.method === 'string') {
      if ('id' in value) {
        const request = value as unknown as JsonRpcRequest
        Promise.resolve(this.requestHandler(request.method, request.params)).then(
          (result) => this.write({ jsonrpc: '2.0', id: request.id, result }),
          (error: unknown) => this.write({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: error instanceof Error ? error.message : 'server request failed' } }),
        ).catch(() => {})
      } else {
        for (const listener of this.notificationListeners) listener(value as unknown as JsonRpcNotification)
      }
      return
    }
    if ('id' in value) {
      const response = value as unknown as JsonRpcResponse
      const pending = this.pending.get(response.id)
      if (!pending) return
      if (response.error) pending.reject(new Error(`${response.error.code}: ${response.error.message}`))
      else pending.resolve(response.result)
      this.pending.delete(response.id)
    }
  }

  private write(message: JsonRpcMessage): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.output.write(encodeJsonRpc(message), (error?: Error | null) => error ? reject(error) : resolve())
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
