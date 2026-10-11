import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { WebstackLspError } from '../errors.js'
import type { StructureLanguage } from './types.js'

export interface StructureWorkerRequest {
  operation: 'matches' | 'enclosing' | 'inspect'
  language: StructureLanguage
  text: string
  querySource: string
  limit: number
  snapshotHandle?: string
  previousSnapshotHandle?: string
  startIndex?: number
  endIndex?: number
  index?: number
  kinds?: string[]
}

export interface WorkerNodeSummary {
  kind: string
  startIndex: number
  endIndex: number
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  nameStartIndex?: number
  nameEndIndex?: number
  childCount: number
}

export interface WorkerErrorSummary { hasError: boolean; errorNodes: number; missingNodes: number; truncated: boolean }
export interface WorkerMatch { captures: Array<{ name: string } & WorkerNodeSummary> }
export interface StructureWorkerResult {
  status: 'ok' | 'partial'
  abiVersion?: number
  reusedTree?: boolean
  incremental?: boolean
  matches?: WorkerMatch[]
  nodes?: WorkerNodeSummary[]
  truncated?: boolean
  errors: WorkerErrorSummary
}

interface WorkerReply { id: string; ok: boolean; value?: StructureWorkerResult; error?: string }
interface PendingTask {
  id: string
  request: StructureWorkerRequest
  signal?: AbortSignal
  resolve(value: StructureWorkerResult): void
  reject(error: unknown): void
  timer?: ReturnType<typeof setTimeout>
  removeAbort?: () => void
}
interface WorkerSlot { worker: Worker; current: PendingTask | undefined; completed: number; failed: boolean }

const MAX_WORKERS = 2
const MAX_QUEUE = 16
const WORKER_TASK_LIMIT = 100
const PARSE_TIMEOUT_MS = 2_000

/** CPU-bound parsing runs off the event loop; cancellation terminates the active worker. */
export class StructureWorkerPool {
  private readonly slots = new Set<WorkerSlot>()
  private readonly queue: PendingTask[] = []
  private disposed = false

  execute(request: StructureWorkerRequest, signal?: AbortSignal): Promise<StructureWorkerResult> {
    if (this.disposed) return Promise.reject(new WebstackLspError('LSP_DISPOSED', 'structure worker pool is disposed'))
    if (signal?.aborted) return Promise.reject(abortError())
    if (this.queue.length >= MAX_QUEUE) return Promise.reject(new WebstackLspError('LSP_STRUCTURE_BUSY', 'structure worker queue is full'))
    return new Promise((resolve, reject) => {
      const task: PendingTask = { id: randomUUID(), request, ...(signal ? { signal } : {}), resolve, reject }
      if (signal) {
        const abort = () => {
          const index = this.queue.indexOf(task)
          if (index >= 0) { this.queue.splice(index, 1); this.finishTask(task, abortError()) }
          else {
            const slot = [...this.slots].find(candidate => candidate.current === task)
            if (slot) void this.retire(slot, abortError())
          }
        }
        signal.addEventListener('abort', abort, { once: true })
        task.removeAbort = () => signal.removeEventListener('abort', abort)
      }
      this.queue.push(task)
      this.pump()
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const task of this.queue.splice(0)) this.finishTask(task, new WebstackLspError('LSP_DISPOSED', 'structure worker pool is disposed'))
    await Promise.all([...this.slots].map(slot => this.retire(slot, new WebstackLspError('LSP_DISPOSED', 'structure worker pool is disposed'))))
  }

  releaseSnapshot(snapshotHandle: string): void {
    for (const slot of this.slots) {
      if (!slot.failed) {
        try { slot.worker.postMessage({ releaseSnapshotHandle: snapshotHandle }) }
        catch { void this.retire(slot, new WebstackLspError('LSP_STRUCTURE_UNAVAILABLE', 'structure worker could not release a cached snapshot')) }
      }
    }
  }

  get queued(): number { return this.queue.length }
  get active(): number { return [...this.slots].filter(slot => slot.current !== undefined).length }

  private pump(): void {
    if (this.disposed) return
    while (this.queue.length) {
      let slot = [...this.slots].find(candidate => !candidate.current && !candidate.failed)
      if (!slot && this.slots.size < MAX_WORKERS) slot = this.createWorker()
      if (!slot) return
      const task = this.queue.shift()!
      if (task.signal?.aborted) { this.finishTask(task, abortError()); continue }
      slot.current = task
      task.timer = setTimeout(() => { void this.retire(slot!, new WebstackLspError('LSP_STRUCTURE_TIMEOUT', 'structure parsing exceeded its time limit')) }, PARSE_TIMEOUT_MS)
      try { slot.worker.postMessage({ id: task.id, ...task.request }) }
      catch (error) { void this.retire(slot, error) }
    }
  }

  private createWorker(): WorkerSlot {
    const worker = new Worker(new URL('./parser-worker.mjs', import.meta.url))
    const slot: WorkerSlot = { worker, current: undefined, completed: 0, failed: false }
    this.slots.add(slot)
    worker.on('message', (reply: WorkerReply) => {
      if (!slot.current || reply.id !== slot.current.id) { void this.retire(slot, new WebstackLspError('LSP_MALFORMED_RESPONSE', 'structure worker returned an unexpected task identity')); return }
      const task = slot.current
      slot.current = undefined
      slot.completed++
      if (!reply.ok || !reply.value) this.finishTask(task, new WebstackLspError('LSP_STRUCTURE_UNAVAILABLE', reply.error ?? 'structure parsing failed'))
      else this.finishTask(task, undefined, reply.value)
      if (slot.completed >= WORKER_TASK_LIMIT) void this.retire(slot)
      this.pump()
    })
    worker.on('error', error => { void this.retire(slot, error) })
    worker.on('exit', code => {
      if (this.slots.has(slot) && !slot.failed) void this.retire(slot, code === 0 ? undefined : new WebstackLspError('LSP_STRUCTURE_UNAVAILABLE', `structure worker exited (${code})`))
    })
    return slot
  }

  private async retire(slot: WorkerSlot, error?: unknown): Promise<void> {
    if (slot.failed) return
    slot.failed = true
    this.slots.delete(slot)
    const task = slot.current
    slot.current = undefined
    if (task) this.finishTask(task, error ?? new WebstackLspError('LSP_STRUCTURE_UNAVAILABLE', 'structure worker was restarted'))
    await slot.worker.terminate().catch(() => 0)
    this.pump()
  }

  private finishTask(task: PendingTask, error?: unknown, value?: StructureWorkerResult): void {
    if (task.timer) clearTimeout(task.timer)
    task.removeAbort?.()
    if (error !== undefined) task.reject(error)
    else task.resolve(value!)
  }
}

function abortError(): DOMException { return new DOMException('The operation was aborted', 'AbortError') }
