export function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

export function onAbort(signal: AbortSignal | undefined, callback: () => void): () => void {
  if (!signal) return () => {}
  if (signal.aborted) {
    callback()
    return () => {}
  }
  signal.addEventListener('abort', callback, { once: true })
  return () => signal.removeEventListener('abort', callback)
}

export async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const remove = onAbort(signal, () => reject(abortError()))
    promise.then((value) => { remove(); resolve(value) }, (error: unknown) => { remove(); reject(error) })
  })
}
