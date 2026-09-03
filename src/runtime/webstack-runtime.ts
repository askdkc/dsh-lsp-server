import type { ResolvedConfig } from '../config.js'
import type { SourceReader } from '../host/source.js'
import type { ServerSession } from './server-session.js'
import { ServerPool } from './server-pool.js'

export interface RuntimeQuery<T> {
  serverId: string
  workspace: string
  task(session: ServerSession, source: { path: string; text: string }): Promise<T>
  filePath: string
  signal?: AbortSignal
}

export class WebstackLspRuntime {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly sourceReader: SourceReader,
    private readonly pool: ServerPool<ServerSession>,
  ) {}

  async query<T>(request: RuntimeQuery<T>): Promise<T> {
    const source = await this.sourceReader.read(request.workspace as unknown as { root: string }, request.filePath, this.config.limits.maxDocumentBytes)
    return this.pool.runWithRetry(request.serverId, request.workspace, (session) => request.task(session, source), request.signal)
  }

  async dispose(): Promise<void> {
    await this.pool.disposeAll()
  }
}
