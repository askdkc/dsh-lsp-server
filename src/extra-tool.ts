import type { CompletionRequest, DiagnosticsRequest, WebstackLspService } from './service.js'

export const name = 'lsp_extra'
export const inject = ['tools', 'systemPrompt', 'webstackLsp'] as const

export interface ExtraToolContext {
  tools: { register?(tool: ExtraTool): void }
  systemPrompt?: { append?(text: string): void }
  webstackLsp: WebstackLspService
}

export interface ExtraTool {
  name: typeof name
  execute(input: unknown, signal?: AbortSignal): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseInput(input: unknown): Record<string, unknown> {
  if (!isRecord(input) || typeof input.operation !== 'string') throw new TypeError('lsp_extra requires an operation')
  return input
}

export function createExtraTool(service: WebstackLspService): ExtraTool {
  return {
    name,
    async execute(input, signal) {
      const request = parseInput(input)
      if (request.operation === 'status') return service.status()
      if (request.operation === 'diagnostics') return service.diagnostics(request as unknown as DiagnosticsRequest, signal)
      if (request.operation === 'completion') return service.completion(request as unknown as CompletionRequest, signal)
      throw new TypeError(`unsupported lsp_extra operation: ${request.operation}`)
    },
  }
}

export function apply(ctx: ExtraToolContext): void {
  ctx.tools.register?.(createExtraTool(ctx.webstackLsp))
  ctx.systemPrompt?.append?.('Use lsp_extra diagnostics after edits or when static errors are suspected. Use lsp_extra completion only for exact framework or Tailwind candidates. Neither tool applies edits.')
}
