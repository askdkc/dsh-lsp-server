import { Language, Parser, Query } from 'web-tree-sitter'

const port = (await import('node:worker_threads')).parentPort
if (!port) throw new Error('structure worker requires a parent port')

const assets = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  php: 'tree-sitter-php.wasm',
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
  return request.language === 'svelte' ? runSvelte(request) : runScript(request)
}

// Let Svelte identify its actual top-level scripts. Recover incomplete script
// bodies with Tree-sitter instead of treating an Acorn failure as a clean file.
async function runSvelte(request) {
  const { parse, preprocess } = await import('svelte/compiler')
  // Svelte strips a leading BOM; replacing it keeps original UTF-16 offsets.
  const source = request.text.replace(/^\uFEFF/, ' ')
  let ast
  try { ast = parse(source, { modern: true, loose: true }) }
  catch {
    // The compiler preprocessor is a fallback only: its tag scanner can mistake
    // script-looking strings in valid markup for tags, unlike the real parser.
    const mask = ({ content }) => ({ code: content.replace(/[^\r\n]/g, ' ') })
    const masked = await preprocess(source, { script: mask, style: mask })
    if (masked.code.length !== source.length) throw new Error('Svelte preprocessing changed source offsets')
    ast = parse(masked.code, { modern: true, loose: true })
  }
  const scripts = [ast.instance, ast.module].filter(Boolean).sort((a, b) => a.start - b.start)
  const errors = { hasError: false, errorNodes: 0, missingNodes: 0, truncated: false }
  const matches = [], nodes = []
  let truncated = false, reusedTree = scripts.length > 0, incremental = false
  for (const script of scripts) {
    const start = script.content.start, end = script.content.end
    if (request.operation === 'enclosing' && (request.index < start || request.index >= end)) continue
    const lang = script.attributes.find(attribute => attribute.name === 'lang')
    const language = lang?.value?.[0]?.data === 'ts' ? 'typescript' : 'javascript'
    if (lang && !['ts', 'js', 'javascript'].includes(lang.value?.[0]?.data)) throw new Error('unsupported Svelte script language')
    const key = script.context
    const result = await runScript({
      ...request, language, text: request.text.slice(start, end),
      querySource: request.scriptQueries?.[language] ?? request.querySource,
      snapshotHandle: request.snapshotHandle ? `${request.snapshotHandle}:${key}` : undefined,
      previousSnapshotHandle: request.previousSnapshotHandle ? `${request.previousSnapshotHandle}:${key}` : undefined,
      ownerSnapshotHandle: request.snapshotHandle,
      ...(request.index === undefined ? {} : { index: request.index - start }),
      ...(request.startIndex === undefined ? {} : { startIndex: Math.max(0, Math.min(end - start, request.startIndex - start)) }),
      ...(request.endIndex === undefined ? {} : { endIndex: Math.max(0, Math.min(end - start, request.endIndex - start)) }),
    })
    errors.hasError ||= result.errors.hasError
    errors.errorNodes = Math.min(100, errors.errorNodes + result.errors.errorNodes)
    errors.missingNodes = Math.min(100, errors.missingNodes + result.errors.missingNodes)
    errors.truncated ||= result.errors.truncated
    reusedTree &&= Boolean(result.reusedTree)
    incremental ||= Boolean(result.incremental)
    truncated ||= Boolean(result.truncated)
    const offset = pointAt(request.text, start)
    const originalPoint = point => ({ row: point.row + offset.row, column: point.column + (point.row === 0 ? offset.column : 0) })
    const original = node => ({
      ...node, startIndex: node.startIndex + start, endIndex: node.endIndex + start,
      startPosition: originalPoint(node.startPosition),
      endPosition: originalPoint(node.endPosition),
      ...(node.nameStartIndex === undefined ? {} : { nameStartIndex: node.nameStartIndex + start, nameEndIndex: node.nameEndIndex + start }),
    })
    if (request.startIndex === undefined || request.endIndex === undefined || (request.startIndex < end && request.endIndex > start)) {
      matches.push(...(result.matches ?? []).map(match => ({ captures: match.captures.map(original) })))
    }
    nodes.push(...(result.nodes ?? []).map(original))
  }
  return { status: errors.hasError ? 'partial' : 'ok', errors, matches: matches.slice(0, request.limit + 1), nodes, truncated: truncated || matches.length > request.limit, reusedTree, incremental }
}

async function runScript(request) {
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
      if (request.snapshotHandle) trees.set(request.snapshotHandle, { ...previous, ownerSnapshotHandle: request.ownerSnapshotHandle })
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
        trees.set(request.snapshotHandle, { tree, text: request.text, languageName: request.language, bytes, ownerSnapshotHandle: request.ownerSnapshotHandle })
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
        // Query index bounds use the underlying byte units; point columns use UTF-16.
        ...(request.startIndex === undefined ? {} : { startPosition: pointAt(request.text, request.startIndex) }),
        ...(request.endIndex === undefined ? {} : { endPosition: pointAt(request.text, request.endIndex) }),
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
    for (const [key, cached] of trees) {
      if (key === request.releaseSnapshotHandle || cached.ownerSnapshotHandle === request.releaseSnapshotHandle) {
        trees.delete(key)
        cachedBytes -= cached.bytes
        cached.tree.delete()
      }
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
