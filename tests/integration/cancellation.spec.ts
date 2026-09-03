import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { JsonRpcConnection } from '../../src/runtime/connection.js'
import { encodeJsonRpc } from '../../src/runtime/framing.js'

describe('JsonRpcConnection', () => {
  it('correlates responses and sends cancellation', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const connection = new JsonRpcConnection(input, output, { maxMessageBytes: 4096 })
    const request = connection.request('hover', { text: 'x' })
    const sent = await readOne(output)
    const id = (JSON.parse(sent.body) as { id: number }).id
    input.write(encodeJsonRpc({ jsonrpc: '2.0', id, result: { contents: 'ok' } }))
    await expect(request).resolves.toEqual({ contents: 'ok' })

    const controller = new AbortController()
    const cancelled = connection.request('slow', undefined, controller.signal)
    await readOne(output)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect((await readOne(output)).body).toContain('$/cancelRequest')
  })
})

async function readOne(stream: PassThrough): Promise<{ body: string }> {
  return new Promise((resolve) => stream.once('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    const split = text.indexOf('\r\n\r\n')
    resolve({ body: text.slice(split + 4) })
  }))
}
