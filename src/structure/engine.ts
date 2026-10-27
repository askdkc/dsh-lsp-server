import { randomUUID } from 'node:crypto'
import { WebstackLspError } from '../errors.js'
import { Utf16Coordinates } from './coordinates.js'
import { getRegisteredQuery, isRegisteredQueryId } from './queries.js'
import { scopeIdentity, type SnapshotRecord } from './snapshots.js'
import { StructureWorkerPool } from './worker-pool.js'
import type { SnapshotScope, StructureCapture, StructureEnclosingResult, StructureErrorSummary, StructureLanguage, StructureNode, StructureOutlineResult, StructureQueryResult, StructureSpanResult } from './types.js'

export const MAX_CAPTURES = 200
export const MAX_OUTLINE = 100
export const MAX_SPAN_CHARS = 8_000
export const MAX_STRUCTURE_RESPONSE_BYTES = 32 * 1024
const MAX_NODE_HANDLES = 10_000

interface NodeHandleRecord {
  scopeKey: string
  snapshotHandle: string
  startIndex: number
  endIndex: number
  kind: string
  range: StructureNode['range']
}

export class StructureEngine {
  private readonly nodeHandles = new Map<string, NodeHandleRecord>()
  private readonly snapshotOwners = new Map<string, string>()
  private readonly parserFailures = new Map<StructureLanguage, string>()
  constructor(private readonly workers = new StructureWorkerPool()) {}

  async inspect(record: SnapshotRecord, signal?: AbortSignal): Promise<{ available: boolean; parseErrors: boolean; reason?: string }> {
    this.snapshotOwners.set(record.descriptor.handle, record.scopeKey)
    const language = record.descriptor.language
    if (!language) return { available: false, parseErrors: false, reason: 'grammar_missing' }
    try {
      const result = await this.runWorker(language, { operation: 'inspect', language, text: record.source.text, querySource: '', limit: 1, snapshotHandle: record.descriptor.handle, ...(record.previousSnapshotHandle ? { previousSnapshotHandle: record.previousSnapshotHandle } : {}) }, signal)
      this.parserFailures.delete(language)
      return { available: true, parseErrors: result.errors.hasError }
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 128) : 'parser_unavailable'
      return { available: false, parseErrors: false, reason }
    }
  }

  async outline(record: SnapshotRecord, scope: SnapshotScope, options: { range?: StructureNode['range']; limit?: number } = {}, signal?: AbortSignal): Promise<StructureOutlineResult> {
    const language = record.descriptor.language
    if (!language) return { status: 'unsupported', handle: record.descriptor.handle, version: record.descriptor.version, declarations: [], truncated: false, processed: 0, errors: { hasError: false, errorNodes: 0, missingNodes: 0, truncated: false } }
    const limit = positiveLimit(options.limit, MAX_OUTLINE, 'outline limit')
    const coordinates = new Utf16Coordinates(record.source.text)
    const range = options.range ? coordinates.rangeToIndices(options.range) : undefined
    const result = await this.runMatches(language, record, 'declarations', limit, range, signal)
    const declarations: StructureNode[] = []
    for (const match of result.matches ?? []) {
      const declaration = match.captures.find(capture => capture.name === 'declaration')
      const nameCapture = match.captures.find(capture => capture.name === 'name')
      if (!declaration) continue
      const node = this.node(record, scope, declaration.kind, declaration.startIndex, declaration.endIndex, nameCapture ? record.source.text.slice(nameCapture.startIndex, nameCapture.endIndex).slice(0, 256) : undefined, declaration.childCount, coordinates)
      declarations.push(node)
    }
    return this.outlineResult(record, declarations, result, limit)
  }

  async enclosing(record: SnapshotRecord, scope: SnapshotScope, position: { line: number; character: number }, kinds?: string[], signal?: AbortSignal): Promise<StructureEnclosingResult> {
    const language = record.descriptor.language
    if (!language) return { status: 'unsupported', handle: record.descriptor.handle, version: record.descriptor.version, ancestors: [] }
    const coordinates = new Utf16Coordinates(record.source.text)
    const index = coordinates.positionToIndex(position)
    if (kinds && (!Array.isArray(kinds) || kinds.length > 32 || kinds.some(kind => typeof kind !== 'string' || kind.length > 128 || !/^[a-z][a-z0-9_]*$/u.test(kind))))
      throw new WebstackLspError('LSP_STRUCTURE_LIMIT', 'kinds must be a list of at most 32 node type names')
    const result = await this.runWorker(language, { operation: 'enclosing', language, text: record.source.text, querySource: '', limit: 16, snapshotHandle: record.descriptor.handle, index, ...(kinds ? { kinds: [...kinds] } : {}) }, signal)
    const nodes = result.nodes ?? []
    const summaries = nodes.map(item => this.node(record, scope, item.kind, item.startIndex, item.endIndex, undefined, item.childCount, coordinates))
    const [node, ...ancestors] = summaries
    return { status: result.status, handle: record.descriptor.handle, version: record.descriptor.version, ...(node ? { node } : {}), ancestors, errors: publicErrors(result.errors) }
  }

  async query(record: SnapshotRecord, scope: SnapshotScope, queryId: string, options: { range?: StructureNode['range']; limit?: number } = {}, signal?: AbortSignal): Promise<StructureQueryResult> {
    const language = record.descriptor.language
    if (!language) throw new WebstackLspError('LSP_STRUCTURE_UNSUPPORTED', 'no bundled Tree-sitter grammar is available for this document')
    if (!isRegisteredQueryId(queryId)) throw new WebstackLspError('LSP_STRUCTURE_UNSUPPORTED', 'queryId is not in the registered query allowlist')
    const limit = positiveLimit(options.limit, MAX_CAPTURES, 'capture limit')
    const coordinates = new Utf16Coordinates(record.source.text)
    const range = options.range ? coordinates.rangeToIndices(options.range) : undefined
    const result = await this.runMatches(language, record, queryId, limit, range, signal)
    const captures: StructureCapture[] = []
    captureLoop: for (const match of result.matches ?? []) for (const capture of match.captures) {
      const node = this.node(record, scope, capture.kind, capture.startIndex, capture.endIndex, undefined, capture.childCount, coordinates)
      captures.push({ capture: capture.name, kind: capture.kind, range: node.range, nodeHandle: node.handle, ...(capture.name === 'name' ? { name: record.source.text.slice(capture.startIndex, capture.endIndex).slice(0, 256) } : {}) })
      if (captures.length >= limit) break captureLoop
    }
    if (Buffer.byteLength(JSON.stringify(captures), 'utf8') > MAX_STRUCTURE_RESPONSE_BYTES) throw new WebstackLspError('LSP_STRUCTURE_LIMIT', 'query result exceeds the response byte limit')
    return { status: result.status, handle: record.descriptor.handle, version: record.descriptor.version, queryId, captures, truncated: Boolean(result.truncated || (result.matches ?? []).reduce((total, match) => total + match.captures.length, 0) > limit), processed: captures.length, errors: publicErrors(result.errors) }
  }

  async span(record: SnapshotRecord, scope: SnapshotScope, nodeHandle: string, maxChars = MAX_SPAN_CHARS): Promise<StructureSpanResult> {
    const handle = this.nodeHandles.get(nodeHandle)
    if (!handle || handle.snapshotHandle !== record.descriptor.handle || handle.scopeKey !== scopeIdentity(scope))
      throw new WebstackLspError('LSP_STALE_SNAPSHOT', 'node handle is stale or belongs to another owner')
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > MAX_SPAN_CHARS)
      throw new WebstackLspError('LSP_STRUCTURE_LIMIT', `maxChars must be between 1 and ${MAX_SPAN_CHARS}`)
    const full = record.source.text.slice(handle.startIndex, handle.endIndex)
    const codePoints = Array.from(full)
    const truncated = codePoints.length > maxChars
    const text = codePoints.slice(0, maxChars).join('')
    if (Buffer.byteLength(text, 'utf8') > MAX_STRUCTURE_RESPONSE_BYTES) throw new WebstackLspError('LSP_STRUCTURE_LIMIT', 'span result exceeds the response byte limit')
    return { status: truncated ? 'partial' : 'ok', text, truncated, range: handle.range }
  }

  releaseSnapshot(handle: string): void {
    for (const [nodeHandle, node] of this.nodeHandles) if (node.snapshotHandle === handle) this.nodeHandles.delete(nodeHandle)
    this.snapshotOwners.delete(handle)
    this.workers.releaseSnapshot(handle)
  }

  releaseSnapshotForOwner(scope: SnapshotScope, handle: string): void {
    if (this.snapshotOwners.get(handle) === scopeIdentity(scope)) this.releaseSnapshot(handle)
  }

  snapshotForNode(scope: SnapshotScope, nodeHandle: string): string {
    const record = this.nodeHandles.get(nodeHandle)
    if (!record || record.scopeKey !== scopeIdentity(scope)) throw new WebstackLspError('LSP_STALE_SNAPSHOT', 'node handle is stale or belongs to another owner')
    return record.snapshotHandle
  }

  releaseOwner(scope: SnapshotScope): void {
    const owner = scopeIdentity(scope)
    for (const [nodeHandle, node] of this.nodeHandles) if (node.scopeKey === owner) this.nodeHandles.delete(nodeHandle)
    for (const [snapshotHandle, snapshotOwner] of this.snapshotOwners) {
      if (snapshotOwner === owner) this.releaseSnapshot(snapshotHandle)
    }
  }

  capabilities(): Array<{ language: StructureLanguage; extensions: string[]; available: boolean; abiVersion: number | null; lastError?: string }> {
    return [
      this.capability('javascript', ['.js', '.jsx', '.mjs', '.cjs'], 15),
      this.capability('typescript', ['.ts', '.mts', '.cts'], 14),
      this.capability('tsx', ['.tsx'], 14),
      this.capability('php', ['.php'], 15),
      // Svelte uses both script grammars, not a separate grammar ABI.
      this.capability('svelte', ['.svelte'], null),
      this.capability('bash', ['.sh', '.bash', '.zsh', '.ksh'], 15),
      this.capability('c', ['.c', '.h'], 15),
      this.capability('cpp', ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.c++', '.h++'], 14),
      this.capability('c_sharp', ['.cs', '.csx'], 15),
      this.capability('css', ['.css'], 15),
      this.capability('go', ['.go'], 15),
      this.capability('haskell', ['.hs', '.hsc'], 14),
      this.capability('html', ['.html', '.htm', '.xhtml'], 14),
      this.capability('java', ['.java'], 14),
      this.capability('json', ['.json', '.jsonc'], 14),
      this.capability('julia', ['.jl'], 14),
      this.capability('ocaml', ['.ml'], 14),
      this.capability('ocaml_interface', ['.mli'], 14),
      this.capability('python', ['.py', '.pyi', '.pyw'], 15),
      this.capability('ql_dbscheme', ['.dbscheme'], 14),
      this.capability('ruby', ['.rb', '.rake', '.gemspec'], 14),
      this.capability('rust', ['.rs'], 14),
      this.capability('scala', ['.scala', '.sc', '.sbt'], 14),
    ]
  }

  async dispose(): Promise<void> { this.nodeHandles.clear(); this.snapshotOwners.clear(); await this.workers.dispose() }

  private async runMatches(language: StructureLanguage, record: SnapshotRecord, queryId: string, limit: number, range?: { startIndex: number; endIndex: number }, signal?: AbortSignal) {
    if (language === 'svelte') {
      const scriptQueries = { javascript: getRegisteredQuery('javascript', queryId)!, typescript: getRegisteredQuery('typescript', queryId)! }
      return this.runWorker(language, { operation: 'matches', language, text: record.source.text, querySource: '', scriptQueries, limit, snapshotHandle: record.descriptor.handle, ...(range ?? {}) }, signal)
    }
    const querySource = getRegisteredQuery(language, queryId)
    if (!querySource) throw new WebstackLspError('LSP_STRUCTURE_UNSUPPORTED', `query ${queryId} is not registered for ${language}`)
    return this.runWorker(language, { operation: 'matches', language, text: record.source.text, querySource, limit, snapshotHandle: record.descriptor.handle, ...(range ?? {}) }, signal)
  }

  private capability(language: StructureLanguage, extensions: string[], abiVersion: number | null) {
    const lastError = this.parserFailures.get(language)
    return { language, extensions, available: !lastError, abiVersion, ...(lastError ? { lastError } : {}) }
  }

  private async runWorker(language: StructureLanguage, request: Parameters<StructureWorkerPool['execute']>[0], signal?: AbortSignal) {
    try {
      const result = await this.workers.execute(request, signal)
      this.parserFailures.delete(language)
      return result
    } catch (error) {
      if (error instanceof WebstackLspError && ['LSP_STRUCTURE_TIMEOUT', 'LSP_STRUCTURE_UNAVAILABLE'].includes(error.code))
        this.parserFailures.set(language, error.message.slice(0, 128))
      throw error
    }
  }

  private outlineResult(record: SnapshotRecord, declarations: StructureNode[], result: Awaited<ReturnType<StructureWorkerPool['execute']>>, limit: number): StructureOutlineResult {
    const truncated = Boolean(result.truncated || declarations.length > limit)
    const selected = declarations.slice(0, limit)
    const jsonBytes = Buffer.byteLength(JSON.stringify(selected), 'utf8')
    if (jsonBytes > MAX_STRUCTURE_RESPONSE_BYTES) throw new WebstackLspError('LSP_STRUCTURE_LIMIT', 'outline result exceeds the response byte limit')
    return { status: result.status, handle: record.descriptor.handle, version: record.descriptor.version, declarations: selected, truncated, processed: selected.length, errors: publicErrors(result.errors) }
  }

  private node(record: SnapshotRecord, scope: SnapshotScope, kind: string, startIndex: number, endIndex: number, name?: string, childCount?: number, coordinates = new Utf16Coordinates(record.source.text)): StructureNode {
    if (this.nodeHandles.size >= MAX_NODE_HANDLES) throw new WebstackLspError('LSP_SNAPSHOT_LIMIT', 'node handle capacity is full; release a snapshot and retry')
    const handle = randomUUID()
    const range = coordinates.indicesToRange(startIndex, endIndex)
    this.nodeHandles.set(handle, { scopeKey: scopeIdentity(scope), snapshotHandle: record.descriptor.handle, startIndex, endIndex, kind, range })
    return { handle, kind: publicNodeKind(kind), range, ...(name ? { name } : {}), ...(childCount === undefined ? {} : { childCount }) }
  }
}

function positiveLimit(value: number | undefined, maximum: number, label: string): number {
  const limit = value ?? maximum
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) throw new WebstackLspError('LSP_STRUCTURE_LIMIT', `${label} must be between 1 and ${maximum}`)
  return limit
}

function publicErrors(errors: StructureErrorSummary): StructureErrorSummary { return { ...errors } }

const PUBLIC_NODE_KINDS: Record<string, string> = {
  function_declaration: 'function', function_definition: 'function', function_item: 'function',
  class_declaration: 'class', class_definition: 'class', class_specifier: 'class',
  struct_declaration: 'struct', struct_item: 'struct', struct_specifier: 'struct',
  struct_definition: 'struct',
  interface_declaration: 'interface', trait_definition: 'interface',
  type_alias_declaration: 'type', type_definition: 'type', type_item: 'type',
  type_spec: 'type', type_binding: 'type', type_synomym: 'type',
  enum_declaration: 'enum', enum_item: 'enum', enum_specifier: 'enum',
  method_definition: 'method', method_declaration: 'method',
  variable_declarator: 'variable', value_definition: 'variable',
  value_specification: 'value',
  module_definition: 'module', mod_item: 'module', namespace_definition: 'module',
  namespace_declaration: 'module',
  data_type: 'data', newtype: 'data', abstract_definition: 'abstract',
  record_declaration: 'record', annotation_type_declaration: 'annotation',
}

function publicNodeKind(kind: string): string { return PUBLIC_NODE_KINDS[kind] ?? kind }
