import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './provider.js'
import type { WebstackLspService } from './service.js'
import { WebstackLspError } from './errors.js'
import { mergeDiagnostics } from './merge/diagnostics.js'
import { mergeCompletions } from './merge/completion.js'

export const name = 'lsp_extra'
export const inject = ['tools', 'systemPrompt', 'webstackLsp']
export interface Config { maxDiagnostics?: number; maxCompletions?: number; maxResultChars?: number; timeoutMs?: number }

export function createExtraTool(service: WebstackLspService, config: Config = {}): ToolDefinition {
  const limits = { maxDiagnostics: 200, maxCompletions: 100, maxResultChars: 32000, timeoutMs: 60000, ...config }
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new TypeError(`${key} must be a positive integer no greater than 2147483647`)
  return defineTool({
    name,
    description: 'Read language-server status, diagnostics, or completion candidates. file_path is workspace-relative. Completion line and character are one-based UTF-16. No edits are applied.',
    parameters: {
      operation: { type: 'string', enum: ['status', 'diagnostics', 'completion'], required: true },
      file_path: { type: 'string' }, line: { type: 'integer' }, character: { type: 'integer' },
      severity: { type: 'string', enum: ['all', 'error', 'warning'] },
      servers: { type: 'array', items: { type: 'string' } },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const text = JSON.stringify(value)
        return [{ type: 'text', text: text.length <= limits.maxResultChars ? text : `${text.slice(0, Math.max(0, limits.maxResultChars - 14))}\n[truncated]`.slice(0, limits.maxResultChars) }]
      },
    },
    timeoutMs: limits.timeoutMs,
    async execute(args, exec) {
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(limits.timeoutMs)])
      signal.throwIfAborted()
      let result: unknown
      if (args.operation === 'status') result = await service.status()
      else {
        const workspaceRoot = exec.agent?.session.header.cwd
        if (!workspaceRoot) throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'lsp_extra requires a session workspace cwd')
        if (!args.file_path) throw new TypeError('file_path is required')
        if (args.operation === 'diagnostics') {
          const diagnostics = await service.diagnostics({ workspaceRoot, filePath: args.file_path, ...(args.severity ? { severity: args.severity } : {}), ...(args.servers ? { servers: args.servers } : {}) }, signal)
          result = { ...diagnostics, ...mergeDiagnostics([diagnostics.diagnostics], limits) }
        } else {
          if (!args.line || args.line < 1 || !args.character || args.character < 1) throw new TypeError('completion requires positive one-based line and character')
          const completion = await service.completion({ workspaceRoot, filePath: args.file_path, position: { line: args.line - 1, character: args.character - 1 } }, signal)
          result = { ...completion, ...mergeCompletions([completion.items], limits) }
        }
      }
      // Strip undefined optionals and expose a lossless JSON result to DSH's schema validator.
      return JSON.parse(JSON.stringify(result))
    },
  })
}

export function apply(ctx: Context, config: Config = {}): void {
  const tool = createExtraTool(ctx.webstackLsp, config)
  ctx.tools.register(tool)
  ctx.systemPrompt.section({ name: 'tool:lsp_extra', order: 500, text: 'Use lsp_extra diagnostics after edits to inspect static errors. Use completion for exact symbol or framework candidates. Completion cursors are one-based UTF-16; output ranges are zero-based. The tool never applies edits.' })
}
