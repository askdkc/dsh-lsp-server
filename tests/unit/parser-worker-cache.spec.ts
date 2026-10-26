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

  it('maps Svelte worker captures back to original UTF-16 offsets including a BOM and emoji', async () => {
    worker = new Worker(new URL('../../src/structure/parser-worker.mjs', import.meta.url))
    const send = workerClient(worker)
    const text = '\uFEFF<p>😀</p><script>const face = "😀"; function target() { return face }</script>'
    const result = await send({ ...svelteRequest, operation: 'matches', text, snapshotHandle: 'svelte-bom' })
    expect(result.status).toBe('ok')
    const captures = result.matches!.flatMap(match => match.captures)
    const declaration = captures.find(capture => capture.name === 'declaration')!
    const name = captures.find(capture => capture.name === 'name')!
    const declarationText = 'function target() { return face }'
    const startIndex = text.indexOf(declarationText)
    expect(declaration).toMatchObject({
      startIndex, endIndex: startIndex + declarationText.length,
      startPosition: { row: 0, column: startIndex },
      endPosition: { row: 0, column: startIndex + declarationText.length },
      nameStartIndex: text.indexOf('target'), nameEndIndex: text.indexOf('target') + 'target'.length,
    })
    expect(text.slice(declaration.startIndex, declaration.endIndex)).toBe(declarationText)
    expect(text.slice(name.startIndex, name.endIndex)).toBe('target')
  })

  it('caches both Svelte script contexts and releases each tree through the parent snapshot handle', async () => {
    worker = new Worker(new URL('../../src/structure/parser-worker.mjs', import.meta.url))
    const send = workerClient(worker)
    const module = '<script module>export function shared() {}</script>'
    const instance = '<script>function local() {}</script>'
    const text = `${module}\r\n${instance}`
    const request = { ...svelteRequest, operation: 'inspect' as const, text, snapshotHandle: 'svelte-owner' }
    expect((await send(request)).reusedTree).toBe(false)
    expect((await send(request)).reusedTree).toBe(true)
    expect((await send({ ...request, snapshotHandle: 'other-owner' })).reusedTree).toBe(false)
    const matches = await send({ ...request, operation: 'matches' })
    expect(matches.matches!.flatMap(match => match.captures).filter(capture => capture.name === 'name')
      .map(capture => text.slice(capture.startIndex, capture.endIndex))).toEqual(['shared', 'local'])

    worker.postMessage({ releaseSnapshotHandle: request.snapshotHandle })
    // Check each child separately so releasing only one child cannot satisfy the test.
    expect((await send({ ...request, text: module })).reusedTree).toBe(false)
    expect((await send({ ...request, text: module })).reusedTree).toBe(true)
    expect((await send({ ...request, text: instance })).reusedTree).toBe(false)
    expect((await send({ ...request, text: instance })).reusedTree).toBe(true)
    expect((await send({ ...request, snapshotHandle: 'other-owner' })).reusedTree).toBe(true)
  })

  it('remaps retained Svelte trees after markup moves scripts and releases their new owner', async () => {
    worker = new Worker(new URL('../../src/structure/parser-worker.mjs', import.meta.url))
    const send = workerClient(worker)
    const scripts = '<script module lang="ts">export function shared(): void {}</script>\r\n<script lang="ts">function local(): void {}</script>'
    await send({ ...svelteRequest, operation: 'inspect', text: scripts, snapshotHandle: 'before-move' })
    const text = `<p>😀 moved</p>\r\n${scripts}`
    await send({ ...svelteRequest, operation: 'inspect', text, snapshotHandle: 'after-move', previousSnapshotHandle: 'before-move' })
    const reused = await send({ ...svelteRequest, operation: 'matches', text, snapshotHandle: 'after-move' })
    const fresh = await send({ ...svelteRequest, operation: 'matches', text, snapshotHandle: 'fresh' })
    expect(reused.reusedTree).toBe(true)
    expect(reused.matches).toEqual(fresh.matches)
    const names = reused.matches!.flatMap(match => match.captures).filter(capture => capture.name === 'name')
    expect(names.map(capture => text.slice(capture.startIndex, capture.endIndex))).toEqual(['shared', 'local'])
    expect(names.map(capture => capture.startPosition.row)).toEqual([1, 2])
    expect(names.map(capture => capture.startIndex)).toEqual([text.indexOf('shared'), text.indexOf('local')])
    worker.postMessage({ releaseSnapshotHandle: 'before-move' })
    expect((await send({ ...svelteRequest, operation: 'inspect', text, snapshotHandle: 'after-move' })).reusedTree).toBe(true)
    worker.postMessage({ releaseSnapshotHandle: 'after-move' })
    expect((await send({ ...svelteRequest, operation: 'inspect', text, snapshotHandle: 'after-move' })).reusedTree).toBe(false)
  })
})

const declarationQuery = '(function_declaration name: (_) @name) @declaration'
const svelteRequest = {
  language: 'svelte' as const, querySource: '', limit: 20,
  scriptQueries: { javascript: declarationQuery, typescript: declarationQuery },
}

function workerClient(worker: Worker) {
  let sequence = 0
  return (request: StructureWorkerRequest) => new Promise<StructureWorkerResult>((resolve, reject) => {
    const id = `svelte-${++sequence}`
    const finish = (error?: Error, value?: StructureWorkerResult) => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      if (error) reject(error)
      else resolve(value!)
    }
    const onMessage = (reply: { id: string; ok: boolean; value?: StructureWorkerResult; error?: string }) => {
      if (reply.id !== id) return
      if (reply.ok && reply.value) finish(undefined, reply.value)
      else finish(new Error(reply.error ?? 'worker failed'))
    }
    const onError = (error: Error) => finish(error)
    const timer = setTimeout(() => finish(new Error('worker request timed out')), 4_000)
    worker.on('message', onMessage)
    worker.once('error', onError)
    worker.postMessage({ id, ...request })
  })
}
