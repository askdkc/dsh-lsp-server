import { spawn, type ChildProcess } from 'node:child_process'
import { onAbort } from './cancellation.js'

export interface SpawnSpec {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface ShutdownOptions {
  shutdownMs: number
  killGraceMs: number
}

export function spawnServer(spec: SpawnSpec): ChildProcess {
  if (!spec.command || spec.command.includes('\u0000')) throw new Error('invalid executable')
  return spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export async function terminateProcess(child: ChildProcess, options: ShutdownOptions): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const waitForExit = new Promise<void>((resolve) => child.once('close', () => resolve()))
  child.kill('SIGTERM')
  if (await settleWithin(waitForExit, options.shutdownMs)) return
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await settleWithin(waitForExit, options.killGraceMs)
}

export function abortableShutdown(child: ChildProcess, options: ShutdownOptions, signal?: AbortSignal): Promise<void> {
  const promise = terminateProcess(child, options)
  if (!signal) return promise
  return new Promise<void>((resolve, reject) => {
    const remove = onAbort(signal, () => {
      child.kill('SIGKILL')
      reject(new Error('shutdown aborted'))
    })
    promise.then(() => { remove(); resolve() }, (error: unknown) => { remove(); reject(error) })
  })
}

async function settleWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false
  return Promise.race([promise.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs))])
}

export class StderrTail {
  private value = Buffer.alloc(0)

  constructor(private readonly maxBytes: number) {}

  append(chunk: Uint8Array): void {
    const next = Buffer.concat([this.value, Buffer.from(chunk)])
    this.value = next.subarray(Math.max(0, next.length - this.maxBytes))
  }

  text(): string {
    return this.value.toString('utf8')
  }
}
