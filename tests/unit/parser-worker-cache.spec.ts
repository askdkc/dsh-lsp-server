import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import type { StructureWorkerRequest, StructureWorkerResult } from '../../src/structure/worker-pool.js'

describe('Tree-sitter snapshot cache', () => {
  let worker: Worker | undefined
  afterEach(async () => { await worker?.terminate(); worker = undefined })

  it('reuses a tree only for the same opaque snapshot and exact source text', async () => {
    worker = new Worker(new URL('../../src/structure/parser-worker.mjs', import.meta.url))
    let sequence = 0
    const request = (text: string) => new Promise<StructureWorkerResult>((resolve, reject) => {
      const id = `cache-${++sequence}`
      const onMessage = (reply: { id: string; ok: boolean; value?: StructureWorkerResult; error?: string }) => {
        if (reply.id !== id) return
        worker!.off('message', onMessage)
        reply.ok && reply.value ? resolve(reply.value) : reject(new Error(reply.error ?? 'worker failed'))
      }
      worker!.on('message', onMessage)
      const payload: StructureWorkerRequest = {
        operation: 'inspect', language: 'typescript', text, querySource: '', limit: 1,
        snapshotHandle: 'opaque-snapshot-for-test',
      }
      worker!.postMessage({ id, ...payload })
    })

    expect((await request('const answer = 42')).reusedTree).toBe(false)
    expect((await request('const answer = 42')).reusedTree).toBe(true)
    worker.postMessage({ releaseSnapshotHandle: 'opaque-snapshot-for-test' })
    expect((await request('const answer = 42')).reusedTree).toBe(false)
    expect((await request('const answer = 42')).reusedTree).toBe(true)
    expect((await request('const answer = 43')).reusedTree).toBe(false)
    expect((await request('const answer = 43')).reusedTree).toBe(true)
  })

  it('incrementally edits a cached prior tree and matches a fresh parse after Unicode insertion', async () => {
    worker = new Worker(new URL('../../src/structure/parser-worker.mjs', import.meta.url))
    let sequence = 0
    const send = (payload: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
      const id = `edit-${++sequence}`
      const onMessage = (reply: { id: string; ok: boolean; value?: unknown; error?: string }) => {
        if (reply.id !== id) return
        worker!.off('message', onMessage)
        reply.ok ? resolve(reply.value) : reject(new Error(reply.error ?? 'worker failed'))
      }
      worker!.on('message', onMessage)
      worker!.postMessage({ id, ...payload })
    })
    const previous = 'const before = 1; // 😀\r\nfunction target() { return before }\r\n'
    const current = 'const before = 1; // 😀 updated\r\nfunction target() { return before }\r\n'
    const base = { language: 'typescript', querySource: '(function_declaration name: (_) @name) @declaration', limit: 20 }
    await send({ ...base, operation: 'inspect', text: previous, snapshotHandle: 'old' })
    const edited = await send({ ...base, operation: 'inspect', text: current, snapshotHandle: 'new', previousSnapshotHandle: 'old' })
    expect(edited.incremental).toBe(true)
    const reusedMatches = await send({ ...base, operation: 'matches', text: current, snapshotHandle: 'new' })
    const fullMatches = await send({ ...base, operation: 'matches', text: current, snapshotHandle: 'full-parse' })
    expect(reusedMatches.matches).toEqual(fullMatches.matches)
  })
})
