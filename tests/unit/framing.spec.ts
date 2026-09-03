import { describe, expect, it } from 'vitest'
import { ContentLengthDecoder, encodeJsonRpc, JsonRpcFrameError } from '../../src/runtime/framing.js'

describe('ContentLengthDecoder', () => {
  it('decodes partial and multiple frames', () => {
    const decoder = new ContentLengthDecoder(1024)
    const frame = encodeJsonRpc({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    expect(decoder.feed(frame.subarray(0, 10))).toEqual([])
    expect(decoder.feed(Buffer.concat([frame.subarray(10), frame]))).toEqual([{ jsonrpc: '2.0', id: 1, result: { ok: true } }, { jsonrpc: '2.0', id: 1, result: { ok: true } }])
  })

  it('rejects malformed, invalid UTF-8 and oversized frames', () => {
    expect(() => new ContentLengthDecoder(4).feed(Buffer.from('X: 1\r\n\r\n{}'))).toThrow(JsonRpcFrameError)
    expect(() => new ContentLengthDecoder(4).feed(Buffer.from('Content-Length: 5\r\n\r\n12345'))).toThrow('exceeds')
    const utf8 = Buffer.concat([Buffer.from('Content-Length: 1\r\n\r\n'), Buffer.from([0xff])])
    expect(() => new ContentLengthDecoder(10).feed(utf8)).toThrow('UTF-8')
  })
})
