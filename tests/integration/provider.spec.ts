import { describe, expect, it } from 'vitest'
import { createCompositeProvider, OUTER_EXTENSION_MAP } from '../../src/provider.js'

describe('CompositeNavigationProvider', () => {
  it('owns the outer extension map and delegates one query', async () => {
    const calls: unknown[] = []
    const provider = createCompositeProvider({ navigation: async (request) => { calls.push(request); return { hover: null } } })
    await expect(provider.query({ filePath: 'src/app.ts', position: { line: 0, character: 0 }, operation: 'hover' })).resolves.toEqual({ hover: null })
    expect(provider.extensionToLanguage).toEqual(OUTER_EXTENSION_MAP)
    expect(calls).toHaveLength(1)
  })
})
