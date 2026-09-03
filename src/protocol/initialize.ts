import type { InitializeParams, InitializeResult } from './types.js'
import type { JsonRpcConnection } from '../runtime/connection.js'
import { throwIfAborted } from '../runtime/cancellation.js'

export async function initializeServer(connection: JsonRpcConnection, params: InitializeParams, signal?: AbortSignal): Promise<InitializeResult> {
  throwIfAborted(signal)
  const value = await connection.request('initialize', params, signal)
  if (!isInitializeResult(value)) throw new Error('malformed initialize response')
  await connection.notify('initialized', {})
  return value
}

function isInitializeResult(value: unknown): value is InitializeResult {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { capabilities?: unknown }).capabilities === 'object' && (value as { capabilities?: unknown }).capabilities !== null
}
