import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './provider.js'
import type { WebstackLspService } from './service.js'
import { WebstackLspError } from './errors.js'
import { mergeDiagnostics } from './merge/diagnostics.js'
import { mergeCompletions } from './merge/completion.js'
import type { CodeIntelligenceToolServiceV1, SnapshotScope } from './structure/types.js'

export const name = 'lsp_extra'
export const inject = ['tools', 'systemPrompt', 'webstackLsp', 'codeIntelligenceRuntime']
export interface Config { maxDiagnostics?: number; maxCompletions?: number; maxResultChars?: number; timeoutMs?: number }

export function createExtraTool(service: WebstackLspService, codeIntelligence?: CodeIntelligenceToolServiceV1, config: Config = {}): ToolDefinition {
  const limits = { maxDiagnostics: 200, maxCompletions: 100, maxResultChars: 32000, timeoutMs: 60000, ...config }
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new TypeError(`${key} must be a positive integer no greater than 2147483647`)
  return defineTool({
    name,
    description: 'Read language-server status, diagnostics, or completion candidates for PHP/Blade, TypeScript/JavaScript, JSX/TSX, Svelte, HTML and CSS/PCSS. status reports supportedFileSuffixes and server availability. Unsupported document diagnostics return skipped (unverified). file_path is workspace-relative. Completion line and character are one-based UTF-16. No edits are applied.',
    parameters: {
      operation: { type: 'string', enum: ['status', 'diagnostics', 'completion', 'snapshot', 'structure', 'semantic'], required: true },
      action: { type: 'string', enum: ['open', 'release', 'capabilities', 'outline', 'enclosing', 'query', 'span', 'definition', 'references', 'implementation', 'hover', 'diagnostics', 'completion'] },
      file_path: { type: 'string' }, line: { type: 'integer' }, character: { type: 'integer' },
      handle: { type: 'string' }, node_handle: { type: 'string' }, query_id: { type: 'string' }, max_chars: { type: 'integer' }, limit: { type: 'integer' },
      position_line: { type: 'integer' }, position_character: { type: 'integer' },
      start_line: { type: 'integer' }, start_character: { type: 'integer' }, end_line: { type: 'integer' }, end_character: { type: 'integer' },
      kinds: { type: 'array', items: { type: 'string' } },
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
      if (args.operation === 'status') result = { ...(await service.status()), ...(codeIntelligence ? { codeIntelligence: codeIntelligence.capabilities() } : {}) }
      else if (args.operation === 'snapshot' || args.operation === 'structure' || args.operation === 'semantic') {
        if (!codeIntelligence) throw new WebstackLspError('LSP_CODE_INTELLIGENCE_UNAVAILABLE', 'code-intelligence service is unavailable')
        if (args.operation === 'snapshot') {
          if (args.action === 'capabilities') result = codeIntelligence.capabilities()
          else if (args.action === 'open') {
            const scope = snapshotScope(exec.agent)
            if (typeof args.file_path !== 'string') throw new TypeError('file_path is required for snapshot open')
            result = await codeIntelligence.snapshot.open(scope, args.file_path, signal)
          } else if (args.action === 'release') {
            const scope = snapshotScope(exec.agent)
            if (typeof args.handle !== 'string') throw new TypeError('handle is required for snapshot release')
            result = await codeIntelligence.snapshot.release(scope, args.handle)
          } else throw new TypeError('snapshot action must be open, release, or capabilities')
        } else {
          const scope = snapshotScope(exec.agent)
          if (args.operation === 'structure') {
          if (args.action === 'outline') {
            const range = readRange(args)
            result = await codeIntelligence.structure.outline(scope, requiredString(args.handle, 'handle'), { ...(range ? { range } : {}), ...(args.limit === undefined ? {} : { limit: args.limit as number }) }, signal)
          }
          else if (args.action === 'enclosing') result = await codeIntelligence.structure.enclosing(scope, requiredString(args.handle, 'handle'), zeroBasedPosition(args), { ...(args.kinds === undefined ? {} : { kinds: args.kinds as string[] }) }, signal)
          else if (args.action === 'query') {
            const range = readRange(args)
            result = await codeIntelligence.structure.query(scope, requiredString(args.handle, 'handle'), requiredString(args.query_id, 'query_id'), { ...(range ? { range } : {}), ...(args.limit === undefined ? {} : { limit: args.limit as number }) }, signal)
          }
          else if (args.action === 'span') result = await codeIntelligence.structure.span(scope, requiredString(args.node_handle, 'node_handle'), args.max_chars as number | undefined, signal)
          else throw new TypeError('structure action must be outline, enclosing, query, or span')
          } else {
          const action = args.action
          if (!['definition', 'references', 'implementation', 'hover', 'diagnostics', 'completion'].includes(String(action))) throw new TypeError('unsupported semantic action')
          result = await codeIntelligence.semantic.query(scope, requiredString(args.handle, 'handle'), {
            operation: action as 'definition' | 'references' | 'implementation' | 'hover' | 'diagnostics' | 'completion',
            ...(action === 'diagnostics' ? {} : { position: zeroBasedPosition(args) }),
            ...(args.severity ? { severity: args.severity as 'all' | 'error' | 'warning' } : {}),
            ...(args.servers ? { servers: args.servers as string[] } : {}),
          }, signal)
          }
        }
      }
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
  const tool = createExtraTool(ctx.webstackLsp, ctx.codeIntelligenceRuntime, config)
  ctx.tools.register(tool)
  ctx.systemPrompt.section({ name: 'tool:lsp_extra', order: 500, text: 'Use lsp_extra diagnostics after editing supported code files (PHP/Blade, TypeScript/JavaScript, JSX/TSX, Svelte, HTML, CSS/PCSS). Check status for supportedFileSuffixes, code-intelligence parser capabilities and server availability when uncertain. For Markdown and other unsupported documents, use content/structure checks instead. Open a snapshot before structure or semantic queries, pass its handle, and release it when finished. Structure/semantic positions and ranges are zero-based UTF-16; completion cursors remain one-based UTF-16. A skipped query is unverified, never a clean result; do not repeat an unsupported query unchanged. Query IDs are registered and cannot contain arbitrary Tree-sitter queries. The tool never applies edits.' })
}

function snapshotScope(agent: unknown): SnapshotScope {
  if (typeof agent !== 'object' || agent === null) throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'snapshot operations require an active agent session')
  const value = agent as { id?: unknown; session?: { id?: unknown; header?: { cwd?: unknown } } }
  if (typeof value.id !== 'string' || typeof value.session?.id !== 'string' || typeof value.session.header?.cwd !== 'string')
    throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'snapshot operations require trusted owner, session and workspace identity')
  return { ownerId: value.id, sessionId: value.session.id, workspaceRoot: value.session.header.cwd }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`)
  return value
}

function zeroBasedPosition(args: Record<string, unknown>): { line: number; character: number } {
  if (!Number.isSafeInteger(args.position_line) || !Number.isSafeInteger(args.position_character) || (args.position_line as number) < 0 || (args.position_character as number) < 0)
    throw new TypeError('position_line and position_character must be zero-based non-negative UTF-16 offsets')
  return { line: args.position_line as number, character: args.position_character as number }
}

function readRange(args: Record<string, unknown>): { start: { line: number; character: number }; end: { line: number; character: number } } | undefined {
  const fields = [args.start_line, args.start_character, args.end_line, args.end_character]
  if (fields.every(value => value === undefined)) return undefined
  if (fields.some(value => !Number.isSafeInteger(value) || (value as number) < 0)) throw new TypeError('range requires four zero-based non-negative coordinates')
  return { start: { line: args.start_line as number, character: args.start_character as number }, end: { line: args.end_line as number, character: args.end_character as number } }
}
