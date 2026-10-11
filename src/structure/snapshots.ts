import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { WebstackLspError } from '../errors.js'
import type { HostSource } from '../host/dsh.js'
import type { SnapshotDescriptor, SnapshotScope, StructureLanguage } from './types.js'

export const SNAPSHOT_TTL_MS = 5 * 60_000
export const SNAPSHOT_MAX_DOCUMENTS = 32
export const SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024
export const STRUCTURE_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

export interface SnapshotRecord {
  readonly descriptor: SnapshotDescriptor
  readonly scopeKey: string
  readonly source: HostSource
  readonly previousSnapshotHandle?: string
  readonly openedAt: number
  lastUsedAt: number
}

interface VersionRecord { hash: string; version: number; scopeKey: string }

export type SnapshotReader = (workspaceRoot: string, filePath: string, maxBytes: number, signal?: AbortSignal) => Promise<HostSource>

const EXTENSION_LANGUAGE: Record<string, StructureLanguage> = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx',
}

export class DocumentSnapshotStore {
  private readonly records = new Map<string, SnapshotRecord>()
  private readonly versions = new Map<string, VersionRecord>()

  constructor(private readonly readSource: SnapshotReader, private readonly maxDocumentBytes: number) {}

  async open(scope: SnapshotScope, filePath: string, signal?: AbortSignal): Promise<SnapshotRecord> {
    validateScope(scope)
    const normalizedPath = normalizeRelativePath(filePath)
    signal?.throwIfAborted()
    const first = await this.readSource(scope.workspaceRoot, normalizedPath, Math.min(this.maxDocumentBytes, STRUCTURE_MAX_DOCUMENT_BYTES), signal)
    signal?.throwIfAborted()
    const second = await this.readSource(scope.workspaceRoot, normalizedPath, Math.min(this.maxDocumentBytes, STRUCTURE_MAX_DOCUMENT_BYTES), signal)
    if (hashText(first.text) !== hashText(second.text) || first.uri !== second.uri || first.key !== second.key)
      throw new WebstackLspError('LSP_STALE_SNAPSHOT', 'document changed while opening the snapshot')

    const ownerKey = scopeKey(scope)
    const hash = hashText(second.text)
    const fileKey = JSON.stringify([ownerKey, second.key, second.uri])
    const version = this.rememberVersion(fileKey, scope, hash)
    const sourceBytes = Buffer.byteLength(second.text, 'utf8')
    this.evictExpired()
    if (this.records.size >= SNAPSHOT_MAX_DOCUMENTS || this.totalBytes() + sourceBytes > SNAPSHOT_MAX_BYTES)
      throw new WebstackLspError('LSP_SNAPSHOT_LIMIT', 'snapshot capacity is full; release an existing snapshot and retry')

    const descriptor: SnapshotDescriptor = {
      handle: randomUUID(), version, filePath: normalizedPath,
      language: languageForPath(normalizedPath), sourceKind: 'disk', contentHash: hash, sourceBytes,
    }
    const previous = [...this.records.values()]
      .filter(item => item.scopeKey === ownerKey && item.source.key === second.key && item.source.uri === second.uri)
      .sort((a, b) => b.openedAt - a.openedAt)[0]
    const record: SnapshotRecord = {
      descriptor, scopeKey: ownerKey, source: second, openedAt: Date.now(), lastUsedAt: Date.now(),
      ...(previous ? { previousSnapshotHandle: previous.descriptor.handle } : {}),
    }
    this.records.set(descriptor.handle, record)
    return record
  }

  async current(scope: SnapshotScope, handle: string, signal?: AbortSignal): Promise<SnapshotRecord> {
    validateScope(scope)
    signal?.throwIfAborted()
    const record = this.records.get(handle)
    if (!record || record.scopeKey !== scopeKey(scope)) throw staleSnapshot()
    if (Date.now() - record.openedAt > SNAPSHOT_TTL_MS) {
      this.records.delete(handle)
      throw staleSnapshot()
    }
    const current = await this.readSource(scope.workspaceRoot, record.descriptor.filePath, Math.min(this.maxDocumentBytes, STRUCTURE_MAX_DOCUMENT_BYTES), signal)
    signal?.throwIfAborted()
    if (current.uri !== record.source.uri || current.key !== record.source.key || hashText(current.text) !== record.descriptor.contentHash) {
      this.records.delete(handle)
      throw staleSnapshot()
    }
    record.lastUsedAt = Date.now()
    return record
  }

  async readFresh(scope: SnapshotScope, filePath: string, signal?: AbortSignal): Promise<HostSource> {
    validateScope(scope)
    signal?.throwIfAborted()
    const source = await this.readSource(scope.workspaceRoot, filePath, this.maxDocumentBytes, signal)
    signal?.throwIfAborted()
    const fileKey = JSON.stringify([scopeKey(scope), source.key, source.uri])
    this.rememberVersion(fileKey, scope, hashText(source.text))
    return source
  }

  release(scope: SnapshotScope, handle: string): boolean {
    validateScope(scope)
    const record = this.records.get(handle)
    if (!record || record.scopeKey !== scopeKey(scope)) return false
    return this.records.delete(handle)
  }

  releaseOwner(scope: SnapshotScope): number {
    validateScope(scope)
    const owner = scopeKey(scope)
    let released = 0
    for (const [handle, record] of this.records) {
      if (record.scopeKey === owner) { this.records.delete(handle); released++ }
    }
    for (const [key, version] of this.versions) if (version.scopeKey === owner) this.versions.delete(key)
    return released
  }

  clear(): void { this.records.clear(); this.versions.clear() }
  get size(): number { return this.records.size }
  get documentByteLimit(): number { return this.maxDocumentBytes }

  private totalBytes(): number {
    let bytes = 0
    for (const record of this.records.values()) bytes += record.descriptor.sourceBytes
    return bytes
  }

  private rememberVersion(fileKey: string, scope: SnapshotScope, hash: string): number {
    const owner = scopeKey(scope), previous = this.versions.get(fileKey)
    const version = previous ? (previous.hash === hash ? previous.version : previous.version + 1) : 1
    this.versions.delete(fileKey)
    this.versions.set(fileKey, { hash, version, scopeKey: owner })
    while (this.versions.size > 4096) this.versions.delete(this.versions.keys().next().value!)
    return version
  }

  private evictExpired(): void {
    const now = Date.now()
    for (const [handle, record] of this.records) if (now - record.openedAt > SNAPSHOT_TTL_MS) this.records.delete(handle)
  }
}

export function languageForPath(filePath: string): StructureLanguage | null {
  const suffix = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return EXTENSION_LANGUAGE[suffix] ?? null
}

export function validateScope(scope: SnapshotScope): void {
  if (!scope || typeof scope !== 'object' || !scope.ownerId?.trim() || !scope.sessionId?.trim() || !scope.workspaceRoot?.trim() || !isAbsolute(scope.workspaceRoot) || /[\u0000-\u001f\u007f]/u.test(`${scope.ownerId}${scope.sessionId}${scope.workspaceRoot}`))
    throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'trusted owner, session and absolute workspace root are required')
}

export function normalizeRelativePath(filePath: string): string {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.length > 4096 || /[\u0000-\u001f\u007f]/u.test(filePath) || isAbsolute(filePath))
    throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'file path must be a relative workspace path')
  const segments = filePath.replaceAll('\\', '/').split('/')
  if (segments.some(segment => segment === '..' || segment === '')) throw new WebstackLspError('LSP_WORKSPACE_REQUIRED', 'file path contains an invalid segment')
  return segments.filter(segment => segment !== '.').join('/')
}

export function scopeIdentity(scope: SnapshotScope): string { return JSON.stringify([scope.ownerId, scope.sessionId, scope.workspaceRoot]) }
function scopeKey(scope: SnapshotScope): string { return scopeIdentity(scope) }
function hashText(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }
function staleSnapshot(): WebstackLspError { return new WebstackLspError('LSP_STALE_SNAPSHOT', 'snapshot is stale, expired or belongs to another owner') }
