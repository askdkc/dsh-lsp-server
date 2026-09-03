import { once } from 'node:events'
import { stdin, stdout } from 'node:process'
import { encodeJsonRpc, ContentLengthDecoder } from '../../src/runtime/framing.js'

export interface FixtureServerOptions {
  crashOnFirstRequest?: boolean
  ignoreCancellation?: boolean
}

export async function runFixtureServer(options: FixtureServerOptions = {}): Promise<void> {
  const decoder = new ContentLengthDecoder(1024 * 1024)
  let requestCount = 0
  stdin.on('data', (chunk: Buffer) => {
    for (const value of decoder.feed(chunk)) {
      if (typeof value !== 'object' || value === null || !('method' in value)) continue
      const message = value as { id?: string | number; method: string; params?: unknown }
      requestCount += 1
      if (options.crashOnFirstRequest && requestCount === 1) process.exit(17)
      if (message.method === '$/cancelRequest' && !options.ignoreCancellation) continue
      if (message.id === undefined) continue
      const result = message.method === 'initialize' ? { capabilities: { hoverProvider: true } } : null
      stdout.write(encodeJsonRpc({ jsonrpc: '2.0', id: message.id, result }))
    }
  })
  await once(stdin, 'end')
}

if (process.argv[1]?.endsWith('fixture-server.js')) void runFixtureServer()
