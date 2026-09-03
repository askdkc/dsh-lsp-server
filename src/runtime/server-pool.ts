export interface PoolSession {
  readonly state: string
  start(signal?: AbortSignal): Promise<unknown>
  stop(): Promise<void>
  isUsable(): boolean
}

export type SessionFactory<S extends PoolSession> = (serverId: string, workspace: string) => Promise<S>

export class ServerPool<S extends PoolSession> {
  private readonly sessions = new Map<string, S>()
  private readonly creation = new Map<string, Promise<S>>()
  private readonly queues = new Map<string, Promise<void>>()
  private disposing = false

  constructor(private readonly factory: SessionFactory<S>) {}

  async getOrCreate(serverId: string, workspace: string, signal?: AbortSignal): Promise<S> {
    if (this.disposing) throw new Error('server pool is disposing')
    const key = keyOf(serverId, workspace)
    const existing = this.sessions.get(key)
    if (existing?.isUsable()) return existing
    const pending = this.creation.get(key)
    if (pending) return pending
    const creation = this.create(key, serverId, workspace, signal)
    this.creation.set(key, creation)
    try {
      return await creation
    } finally {
      this.creation.delete(key)
    }
  }

  async run<T>(serverId: string, workspace: string, task: (session: S) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const key = keyOf(serverId, workspace)
    const previous = this.queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.queues.set(key, current)
    await previous
    try {
      const session = await this.getOrCreate(serverId, workspace, signal)
      return await task(session)
    } finally {
      release()
      if (this.queues.get(key) === current) this.queues.delete(key)
    }
  }

  async runWithRetry<T>(serverId: string, workspace: string, task: (session: S) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await this.run(serverId, workspace, task, signal)
    } catch (error) {
      await this.evict(serverId, workspace)
      return this.run(serverId, workspace, task, signal)
    }
  }

  async evict(serverId: string, workspace: string): Promise<void> {
    const key = keyOf(serverId, workspace)
    const session = this.sessions.get(key)
    this.sessions.delete(key)
    if (session) await session.stop()
  }

  async disposeAll(): Promise<void> {
    this.disposing = true
    await Promise.all([...this.sessions.values()].map((session) => session.stop()))
    this.sessions.clear()
    await Promise.all([...this.creation.values()].map((creation) => creation.then((session) => session.stop()).catch(() => {})))
    this.creation.clear()
  }

  get size(): number { return this.sessions.size }

  private async create(key: string, serverId: string, workspace: string, signal?: AbortSignal): Promise<S> {
    const session = await this.factory(serverId, workspace)
    await session.start(signal)
    if (this.disposing) {
      await session.stop()
      throw new Error('server pool is disposing')
    }
    this.sessions.set(key, session)
    return session
  }
}

export function keyOf(serverId: string, workspace: string): string {
  return `${serverId}\u0000${workspace}`
}
