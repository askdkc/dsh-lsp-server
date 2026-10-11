import { Language, Parser, Query } from 'web-tree-sitter'

const port = (await import('node:worker_threads')).parentPort
if (!port) throw new Error('structure worker requires a parent port')

const assets = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
}
const MAX_CACHE_ENTRIES = 16
const MAX_CACHE_BYTES = 16 * 1024 * 1024
let init
const languages = new Map()
const trees = new Map()
let cachedBytes = 0

async function loadLanguage(language) {
  if (!assets[language]) throw new Error('unsupported grammar')
  init ??= Parser.init()
  await init
  if (!languages.has(language)) {
    const url = new URL(`./grammars/${assets[language]}`, import.meta.url)
    languages.set(language, await Language.load(url))
  }
  return languages.get(language)
}

function summarizeErrors(root, limit = 100) {
  const stack = [root]
  let errorNodes = 0, missingNodes = 0, visited = 0
  while (stack.length && visited < 200_000) {
    const node = stack.pop()
    visited++
    if (node.type === 'ERROR') errorNodes++
    if (node.isMissing) missingNodes++
    if (errorNodes + missingNodes >= limit) break
    for (const child of node.children) stack.push(child)
  }
  return { hasError: root.hasError, errorNodes: Math.min(errorNodes, limit), missingNodes: Math.min(missingNodes, limit), truncated: stack.length > 0 }
}

function nodeSummary(node) {
  const name = node.childForFieldName('name')
  return {
    kind: node.type,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    ...(name ? { nameStartIndex: name.startIndex, nameEndIndex: name.endIndex } : {}),
    childCount: node.namedChildCount,
  }
}

async function run(request) {
  const language = await loadLanguage(request.language)
  let cached = request.snapshotHandle ? trees.get(request.snapshotHandle) : undefined
  let incremental = false
  if (cached && (cached.languageName !== request.language || cached.text !== request.text)) {
    cached.tree.delete()
    cachedBytes -= cached.bytes
    trees.delete(request.snapshotHandle)
    cached = undefined
  }
  let previous = !cached && request.previousSnapshotHandle ? trees.get(request.previousSnapshotHandle) : undefined
  if (previous && previous.languageName !== request.language) previous = undefined
  let tree = cached?.tree
  let parser
  try {
    if (tree) {
      trees.delete(request.snapshotHandle)
      trees.set(request.snapshotHandle, cached)
    } else if (previous && previous.text === request.text) {
      trees.delete(request.previousSnapshotHandle)
      tree = previous.tree
      if (request.snapshotHandle) trees.set(request.snapshotHandle, previous)
      else { cachedBytes -= previous.bytes; tree.delete() }
    } else {
      parser = new Parser()
      parser.setLanguage(language)
      if (previous) {
        try {
          const edit = changedRange(previous.text, request.text)
          previous.tree.edit(edit)
          tree = parser.parse(request.text, previous.tree)
          incremental = Boolean(tree)
        } catch {
          tree = undefined
        } finally {
          trees.delete(request.previousSnapshotHandle)
          cachedBytes -= previous.bytes
          previous.tree.delete()
        }
      }
      tree ??= parser.parse(request.text)
      if (!tree) throw new Error('parser returned no tree')
      if (request.snapshotHandle && Buffer.byteLength(request.text, 'utf8') <= MAX_CACHE_BYTES) {
        const bytes = Buffer.byteLength(request.text, 'utf8')
        trees.set(request.snapshotHandle, { tree, text: request.text, languageName: request.language, bytes })
        cachedBytes += bytes
        while (trees.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
          const [oldestKey, oldest] = trees.entries().next().value
          trees.delete(oldestKey)
          cachedBytes -= oldest.bytes
          oldest.tree.delete()
          if (oldestKey === request.snapshotHandle) {
            tree = undefined
            break
          }
        }
      }
    }
    const root = tree.rootNode
    const errors = summarizeErrors(root)
    if (request.operation === 'inspect') return { status: errors.hasError ? 'partial' : 'ok', errors, abiVersion: language.abiVersion, reusedTree: Boolean(cached), incremental }
    if (request.operation === 'enclosing') {
      const leaf = root.namedDescendantForIndex(request.index, request.index) ?? root
      const allowed = request.kinds?.length ? new Set(request.kinds) : undefined
      const nodes = []
      for (let node = leaf; node && nodes.length < 16; node = node.parent) {
        if (!allowed || allowed.has(node.type)) nodes.push(nodeSummary(node))
      }
      return { status: errors.hasError ? 'partial' : 'ok', nodes, errors, reusedTree: Boolean(cached), incremental }
    }
    const query = new Query(language, request.querySource)
    try {
      const options = {
        matchLimit: Math.max(1, Math.min(2048, request.limit + 1)),
        ...(request.startIndex === undefined ? {} : { startIndex: request.startIndex }),
        ...(request.endIndex === undefined ? {} : { endIndex: request.endIndex }),
      }
      const matches = query.matches(root, options)
      const result = matches.slice(0, request.limit + 1).map(match => ({
        captures: match.captures.map(capture => ({ name: capture.name, ...nodeSummary(capture.node) })),
      }))
      return { status: errors.hasError ? 'partial' : 'ok', matches: result, truncated: matches.length > request.limit, errors, reusedTree: Boolean(cached), incremental }
    } finally { query.delete() }
  } finally {
    if (tree && (!request.snapshotHandle || trees.get(request.snapshotHandle)?.tree !== tree)) tree.delete()
    parser?.delete()
  }
}

function changedRange(oldText, newText) {
  let prefix = 0
  const sharedLength = Math.min(oldText.length, newText.length)
  while (prefix < sharedLength && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++
  while (prefix > 0 && (splitsSurrogate(oldText, prefix) || splitsSurrogate(newText, prefix))) prefix--

  let suffix = 0
  while (suffix < oldText.length - prefix && suffix < newText.length - prefix &&
    oldText.charCodeAt(oldText.length - suffix - 1) === newText.charCodeAt(newText.length - suffix - 1)) suffix++
  while (suffix > 0 && (splitsSurrogate(oldText, oldText.length - suffix) || splitsSurrogate(newText, newText.length - suffix))) suffix--

  const oldEndIndex = oldText.length - suffix
  const newEndIndex = newText.length - suffix
  return {
    startIndex: prefix,
    oldEndIndex,
    newEndIndex,
    startPosition: pointAt(oldText, prefix),
    oldEndPosition: pointAt(oldText, oldEndIndex),
    newEndPosition: pointAt(newText, newEndIndex),
  }
}

function pointAt(text, index) {
  let row = 0
  let lineStart = 0
  for (let cursor = 0; cursor < index; cursor++) {
    if (text.charCodeAt(cursor) === 10) { row++; lineStart = cursor + 1 }
  }
  return { row, column: index - lineStart }
}

function splitsSurrogate(text, index) {
  if (index <= 0 || index >= text.length) return false
  const before = text.charCodeAt(index - 1)
  const after = text.charCodeAt(index)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

port.on('message', async request => {
  if (typeof request.releaseSnapshotHandle === 'string') {
    const cached = trees.get(request.releaseSnapshotHandle)
    if (cached) {
      trees.delete(request.releaseSnapshotHandle)
      cachedBytes -= cached.bytes
      cached.tree.delete()
    }
    return
  }
  try {
    const value = await run(request)
    port.postMessage({ id: request.id, ok: true, value })
  } catch (error) {
    port.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message.slice(0, 500) : 'structure parse failed' })
  }
})
