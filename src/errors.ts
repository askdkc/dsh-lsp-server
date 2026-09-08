import { LspError } from '@deepseek-ai/dsh-lsp'

export type WebstackErrorCode =
  | 'LSP_UNAVAILABLE'
  | 'LSP_UNSUPPORTED_OPERATION'
  | 'LSP_DISPOSED'
  | 'LSP_MALFORMED_RESPONSE'
  | 'LSP_CONFLICT'
  | 'LSP_WORKSPACE_REQUIRED'
  | 'LSP_WEBSTACK_CONFIG_INVALID'

export class WebstackLspError extends LspError {
  declare readonly code: WebstackErrorCode

  constructor(code: WebstackErrorCode, message: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'WebstackLspError'
  }
}

export function configError(message: string): WebstackLspError {
  return new WebstackLspError('LSP_WEBSTACK_CONFIG_INVALID', message)
}
