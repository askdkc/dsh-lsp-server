// Deterministic executable fixture; all mutations stay inside the test's temp workspace.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
let buffer = Buffer.alloc(0)
const mode = process.argv[2] ?? 'normal'
const trace = process.argv[3]
const send = message => { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message })); process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`); process.stdout.write(body) }
let source, uri, settings, edit
const waiting = []
const hover = id => send({id, result: { contents: JSON.stringify({ source, settings, edit, marker: process.env.WEBSTACK_TEST_MARKER }) }})
const flush = () => { if (settings && edit) for (const id of waiting.splice(0)) hover(id) }
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return
    const size = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + size) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + size)); buffer = buffer.subarray(end + 4 + size)
    if (trace) appendFileSync(trace, JSON.stringify(message) + '\n')
    if (message.id === 'settings') { settings = message.result; flush(); continue }
    if (message.id === 'edit') { edit = message.result; flush(); continue }
    if (message.method === 'initialize') {
      if (mode === 'hang-init') continue
      send({ id: message.id, result: { capabilities: { textDocumentSync: 1, hoverProvider: true, definitionProvider: true, completionProvider: {}, positionEncoding: 'utf-16' } } })
    } else if (message.method === 'initialized') {
      send({ id: 'settings', method: 'workspace/configuration', params: { items: [{ section: 'test' }, { section: 'missing' }] } })
      send({ id: 'edit', method: 'workspace/applyEdit', params: { edit: { changes: {} } } })
    } else if (message.method === 'textDocument/didOpen') {
      source = message.params.textDocument.text; uri = message.params.textDocument.uri
      if (mode !== 'no-diagnostics') send({ method: 'textDocument/publishDiagnostics', params: { uri, version: 1, diagnostics: [] } })
    } else if (message.method === 'textDocument/hover') {
      if (mode === 'hang') continue
      if (mode === 'crash-once' && !existsSync(trace + '.crashed')) { writeFileSync(trace + '.crashed', ''); process.exit(17) }
      if (settings && edit) hover(message.id); else waiting.push(message.id)
    } else if (message.method === 'textDocument/definition') {
      const range = { start: {line:0,character:0}, end:{line:0,character:1} }
      send({ id: message.id, result: [{ targetUri: uri, targetRange: range, targetSelectionRange: range }] })
    } else if (message.method === 'shutdown') send({ id: message.id, result: null })
    else if (message.method === 'exit') process.exit(0)
    else if (message.id !== undefined) send({id:message.id,result:null})
  }
})
