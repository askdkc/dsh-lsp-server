export type JsonRpcId = string | number

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

export interface InitializeParams {
  processId?: number | null
  rootUri?: string | null
  rootPath?: string | null
  capabilities?: Record<string, unknown>
  initializationOptions?: unknown
  workspaceFolders?: Array<{ uri: string; name: string }>
  clientInfo?: { name: string; version?: string }
}

export interface InitializeResult {
  capabilities: Record<string, unknown>
  serverInfo?: { name: string; version?: string }
}

export interface ConfigurationItem {
  scopeUri?: string | null
  section?: string
}

export interface ServerRequestHandler {
  (method: string, params: unknown): Promise<unknown> | unknown
}

export interface JsonRpcConnectionOptions {
  maxMessageBytes: number
  onNotification?: (notification: JsonRpcNotification) => void
  onServerRequest?: ServerRequestHandler
}
