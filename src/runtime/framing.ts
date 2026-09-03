import { TextDecoder } from 'node:util'

export class JsonRpcFrameError extends Error {
  readonly code = 'LSP_MALFORMED_RESPONSE'

  constructor(message: string) {
    super(message)
    this.name = 'JsonRpcFrameError'
  }
}

export class ContentLengthDecoder {
  private buffer = Buffer.alloc(0)
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })

  constructor(private readonly maxMessageBytes: number) {
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0) throw new RangeError('maxMessageBytes must be positive')
  }

  feed(chunk: Uint8Array): unknown[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    const messages: unknown[] = []
    while (true) {
      const headerEnd = this.buffer.indexOf(Buffer.from('\r\n\r\n'))
      if (headerEnd < 0) {
        if (this.buffer.length > 8192) throw new JsonRpcFrameError('header exceeds limit')
        break
      }
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const length = this.parseLength(header)
      const bodyStart = headerEnd + 4
      if (length > this.maxMessageBytes) throw new JsonRpcFrameError('message exceeds configured limit')
      if (this.buffer.length < bodyStart + length) break
      const body = this.buffer.subarray(bodyStart, bodyStart + length)
      this.buffer = this.buffer.subarray(bodyStart + length)
      let text: string
      try {
        text = this.decoder.decode(body)
      } catch {
        throw new JsonRpcFrameError('message is not valid UTF-8')
      }
      try {
        messages.push(JSON.parse(text) as unknown)
      } catch {
        throw new JsonRpcFrameError('message body is not valid JSON')
      }
    }
    return messages
  }

  end(): void {
    if (this.buffer.length > 0) throw new JsonRpcFrameError('incomplete JSON-RPC frame')
  }

  private parseLength(header: string): number {
    const lines = header.split('\r\n')
    let length: number | undefined
    for (const line of lines) {
      const separator = line.indexOf(':')
      if (separator < 1) throw new JsonRpcFrameError('malformed header')
      const key = line.slice(0, separator).toLowerCase()
      const value = line.slice(separator + 1).trim()
      if (key === 'content-length') {
        if (length !== undefined || !/^\d+$/.test(value)) throw new JsonRpcFrameError('invalid Content-Length')
        length = Number(value)
      }
    }
    if (length === undefined || !Number.isSafeInteger(length)) throw new JsonRpcFrameError('Content-Length is required')
    return length
  }
}

export function encodeJsonRpc(message: object): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}
