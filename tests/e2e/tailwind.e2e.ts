import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { harness } from '../fixtures/harness.js'
const require = createRequire(import.meta.url)
it.each(['v3', 'v4'])('Tailwind %s: completion and hover alongside HTML', async version => {
  const root = await mkdtemp(join(tmpdir(), `dsh-tailwind-${version}-`))
  await mkdir(join(root, 'node_modules'))
  const packageRoot = dirname(require.resolve(`tailwindcss-${version}/package.json`))
  await symlink(packageRoot, join(root, 'node_modules/tailwindcss'), 'dir')
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { tailwindcss: version === 'v3' ? '3.4.17' : '4.1.13' } }))
  if (version === 'v3') await writeFile(join(root, 'tailwind.config.cjs'), "module.exports = { content: ['./*.html'], theme: {} };")
  await writeFile(join(root, 'style.css'), version === 'v3' ? '@tailwind utilities;' : '@import "tailwindcss";')
  await writeFile(join(root, 'index.html'), '<div class="flex text-red-500"></div>')
  const h = await harness(root, { servers: { phpantom: { enabled: false } }, tailwind: { enabled: true, queryStrategy: 'always' } })
  try {
    const request = { workspaceRoot: root, filePath: 'index.html', position: {line:0,character:13} }
    const hover = await h.lsp.query({...request,operation:'hover'})
    expect(hover.kind === 'hover' && hover.hover?.contents).toContain('display: flex')
    const completion = await h.extra.completion({...request,position:{line:0,character:15}})
    expect(completion.items.some(item => item.server === 'tailwind' && item.label === 'flex')).toBe(true)
  } finally { await h.dispose(); await rm(root, { recursive: true, force: true }) }
}, 60000)
