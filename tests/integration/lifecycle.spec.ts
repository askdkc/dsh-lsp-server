import { describe, expect, it } from 'vitest'
import { ServerPool, type PoolSession } from '../../src/runtime/server-pool.js'

class FakeSession implements PoolSession {
  state = 'READY'
  starts = 0
  stops = 0
  constructor(private readonly waitMs = 0) {}
  async start(): Promise<void> { this.starts += 1; await new Promise((resolve) => setTimeout(resolve, this.waitMs)) }
  async stop(): Promise<void> { this.stops += 1; this.state = 'STOPPED' }
  isUsable(): boolean { return this.state === 'READY' }
}

describe('ServerPool', () => {
  it('single-flights creation and serializes one key', async () => {
    const created: FakeSession[] = []
    const pool = new ServerPool(async () => { const session = new FakeSession(5); created.push(session); return session })
    const order: number[] = []
    await Promise.all([
      pool.run('ts', '/app', async () => { order.push(1); await new Promise((resolve) => setTimeout(resolve, 5)); order.push(2) }),
      pool.run('ts', '/app', async () => { order.push(3); order.push(4) }),
    ])
    expect(created).toHaveLength(1)
    expect(order).toEqual([1, 2, 3, 4])
    await pool.disposeAll()
    expect(created[0]?.stops).toBe(1)
  })

  it('keeps different server keys independent and retries once after failure', async () => {
    let created = 0
    const pool = new ServerPool(async () => { created += 1; return new FakeSession() })
    await expect(pool.runWithRetry('ts', '/app', async (session) => {
      if (created === 1) { await session.stop(); throw new Error('transport') }
      return 'ok'
    })).resolves.toBe('ok')
    expect(created).toBe(2)
    await pool.disposeAll()
  })
})
