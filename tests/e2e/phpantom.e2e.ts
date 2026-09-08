import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { harness } from '../fixtures/harness.js'

it.skipIf(!process.env.PHPANTOM_E2E)('PHPantom: PHP definition and Blade hover through DSH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-phpantom-'))
  await writeFile(join(root, 'app.php'), '<?php\nfunction greet(string $name): string { return "Hi " . $name; }\necho greet("world");\n')
  await writeFile(join(root, 'view.blade.php'), '<?php $name = "world"; ?>\n<div>{{ $name }}</div>\n')
  const h = await harness(root, { servers: { phpantom: { enabled: true } }, tailwind: { enabled: false } })
  try {
    const result = await h.lsp.query({workspaceRoot:root,filePath:'app.php',operation:'goToDefinition',position:{line:2,character:7}})
    expect(result).toMatchObject({kind:'locations',locations:[{range:{start:{line:1}}}]})
    const blade = await h.lsp.query({workspaceRoot:root,filePath:'view.blade.php',operation:'hover',position:{line:1,character:11}})
    expect(blade.kind).toBe('hover')
  } finally { await h.dispose(); await rm(root, { recursive: true, force: true }) }
}, 60000)
