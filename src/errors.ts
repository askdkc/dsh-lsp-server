export type WebstackErrorCode =
  | 'LSP_UNAVAILABLE'
  | 'LSP_UNSUPPORTED_OPERATION'
  | 'LSP_DISPOSED'
  | 'LSP_MALFORMED_RESPONSE'
  | 'LSP_CONFLICT'
  | 'LSP_WORKSPACE_REQUIRED'
  | 'LSP_WEBSTACK_CONFIG_INVALID'

export class WebstackLspError extends Error {
  readonly code: WebstackErrorCode

  constructor(code: WebstackErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WebstackLspError'
    this.code = code
  }
}

export function configError(message: string): WebstackLspError {
  return new WebstackLspError('LSP_WEBSTACK_CONFIG_INVALID', message)
}
