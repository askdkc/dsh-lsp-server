import { createHash } from 'node:crypto'
import { mkdir, readFile, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Language, MIN_COMPATIBLE_VERSION, Parser, LANGUAGE_VERSION } from 'web-tree-sitter'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const sourceDir = join(root, 'src', 'structure')
const sourceGrammarDir = join(sourceDir, 'grammars')
// The bundled worker pool resolves its worker relative to a chunk in lib/.
const outputDir = join(root, 'lib')
const outputGrammarDir = join(outputDir, 'grammars')
const manifest = JSON.parse(await readFile(join(sourceGrammarDir, 'manifest.json'), 'utf8'))

const runtimeManifest = JSON.parse(await readFile(join(root, 'node_modules', manifest.runtime.package, 'package.json'), 'utf8'))
if (runtimeManifest.version !== manifest.runtime.version) throw new Error(`expected ${manifest.runtime.package}@${manifest.runtime.version}, found ${runtimeManifest.version}`)

await Parser.init()
await mkdir(outputGrammarDir, { recursive: true })
for (const grammar of manifest.grammars) {
  const sourceAsset = join(sourceGrammarDir, grammar.asset)
  const sourceBytes = await readFile(sourceAsset)
  const sha256 = createHash('sha256').update(sourceBytes).digest('hex')
  if (sha256 !== grammar.sha256) throw new Error(`${grammar.asset} does not match its pinned SHA-256`)
  if (grammar.distribution === 'source-build') {
    if (!grammar.sourceRepository || !/^[a-f0-9]{40}$/.test(grammar.sourceCommit) || !grammar.buildRecipe || !grammar.licenseFile)
      throw new Error(`${grammar.asset} is missing source-build provenance`)
    await copyFile(join(sourceGrammarDir, grammar.licenseFile), join(outputGrammarDir, grammar.licenseFile))
  } else {
    const packageRoot = join(root, 'node_modules', grammar.package)
    const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    if (packageManifest.version !== grammar.version) throw new Error(`expected ${grammar.package}@${grammar.version}, found ${packageManifest.version}`)
    const upstreamBytes = await readFile(join(packageRoot, grammar.asset))
    if (createHash('sha256').update(upstreamBytes).digest('hex') !== grammar.sha256)
      throw new Error(`${grammar.asset} does not match its pinned SHA-256`)
  }

  const language = await Language.load(sourceAsset)
  if (language.abiVersion !== grammar.abiVersion || language.abiVersion < MIN_COMPATIBLE_VERSION || language.abiVersion > LANGUAGE_VERSION)
    throw new Error(`${grammar.language} ABI ${language.abiVersion} is incompatible with web-tree-sitter ABI ${MIN_COMPATIBLE_VERSION}-${LANGUAGE_VERSION}`)
  await copyFile(sourceAsset, join(outputGrammarDir, grammar.asset))
}
await copyFile(join(sourceGrammarDir, 'manifest.json'), join(outputGrammarDir, 'manifest.json'))
await copyFile(join(sourceDir, 'parser-worker.mjs'), join(outputDir, 'parser-worker.mjs'))
