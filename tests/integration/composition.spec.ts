import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inject as providerInject, OUTER_EXTENSION_MAP } from '../../src/provider.js'
import { inject as toolInject, name as toolName } from '../../src/extra-tool.js'

describe('DSH composition contract', () => {
  it('declares one provider and one extra tool with required seams', () => {
    const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    expect((patch.match(/id: lsp-webstack-provider/g) ?? []).length).toBe(1)
    expect((patch.match(/id: tool-lsp-extra/g) ?? []).length).toBe(1)
    expect(providerInject).toEqual(['fs', 'lsp', 'subprocess'])
    expect(toolInject).toEqual(['tools', 'systemPrompt', 'webstackLsp'])
    expect(toolName).toBe('lsp_extra')
  })

  it('reserves every supported outer extension exactly once', () => {
    expect(Object.keys(OUTER_EXTENSION_MAP)).toEqual([
      '.php', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
      '.svelte', '.html', '.htm', '.css', '.pcss',
    ])
  })
})
