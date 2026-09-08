import { throwIfAborted, withAbort } from './cancellation.js'

export interface PoolSession {
  readonly state: string
  start(signal?: AbortSignal): Promise<unknown>
  stop(): Promise<void>
  isUsable(): boolean
}
export type SessionFactory<S extends PoolSession> = (serverId: string, workspace: string, signal?: AbortSignal) => Promise<S>

export class ServerPool<S extends PoolSession> {
  private readonly sessions = new Map<string, S>()
  private readonly creation = new Map<string, Promise<S>>()
  private readonly queues = new Map<string, Promise<void>>()
  private disposing = false
  constructor(private readonly factory: SessionFactory<S>) {}

  async getOrCreate(serverId: string, workspace: string, signal?: AbortSignal): Promise<S> {
    throwIfAborted(signal)
    if (this.disposing) throw new Error('server pool is disposing')
    const key = keyOf(serverId, workspace)
    const existing = this.sessions.get(key)
    if (existing?.isUsable()) return existing
    const pending = this.creation.get(key)
    if (pending) return withAbort(pending, signal)
    const creation = this.create(key, serverId, workspace, existing, signal)
    this.creation.set(key, creation)
    try { return await creation }
    finally { if (this.creation.get(key) === creation) this.creation.delete(key) }
  }

  run<T>(serverId: string, workspace: string, task: (session: S) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.serialize(keyOf(serverId, workspace), async () => task(await this.getOrCreate(serverId, workspace, signal)), signal)
  }

  runWithRetry<T>(serverId: string, workspace: string, task: (session: S) => Promise<T>, signal?: AbortSignal): Promise<T> {
    // Keep failure eviction and the retry inside the same queue slot. A later query
    // must never enter a replacement process before the failed query finishes cleanup.
    return this.serialize(keyOf(serverId, workspace), async () => {
      for (let attempt = 0; ; attempt++) {
        const session = await this.getOrCreate(serverId, workspace, signal)
        try { return await task(session) }
        catch (error) {
          throwIfAborted(signal)
          if (attempt > 0 || session.isUsable()) throw error
          if (this.sessions.get(keyOf(serverId, workspace)) === session) await this.evict(serverId, workspace)
        }
      }
    }, signal)
  }

  async evict(serverId: string, workspace: string): Promise<void> {
    const key = keyOf(serverId, workspace)
    const session = this.sessions.get(key)
    this.sessions.delete(key)
    if (session) await session.stop()
  }

  async disposeAll(): Promise<void> {
    this.disposing = true
    const results = await Promise.allSettled([...this.sessions.values()].map(session => session.stop()))
    this.sessions.clear()
    await Promise.all([...this.creation.values()].map(creation => creation.then(session => session.stop(), () => {})))
    this.creation.clear()
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'language server cleanup failed')
  }

  get size(): number { return this.sessions.size }

  private async serialize<T>(key: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    this.queues.set(key, current)
    try {
      await withAbort(previous, signal)
      throwIfAborted(signal)
      return await task()
    } finally {
      // A cancelled waiter cannot let its successor bypass still-running work.
      void previous.then(release, release)
      void current.then(() => { if (this.queues.get(key) === current) this.queues.delete(key) })
    }
  }

  private async create(key: string, serverId: string, workspace: string, previous?: S, signal?: AbortSignal): Promise<S> {
    if (previous) { this.sessions.delete(key); await previous.stop() }
    throwIfAborted(signal)
    const session = await this.factory(serverId, workspace, signal)
    try { await session.start(signal) } catch (error) { await session.stop(); throw error }
    if (this.disposing) { await session.stop(); throw new Error('server pool is disposing') }
    this.sessions.set(key, session)
    return session
  }
}

export function keyOf(serverId: string, workspace: string): string { return `${serverId}\u0000${workspace}` }
