import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, resolveConfig } from '../../src/config.js'
import { WebstackLspError } from '../../src/errors.js'

describe('resolveConfig', () => {
  it('fills safe defaults without mutating input', () => {
    const input = { tailwind: { classAttributes: ['class'] }, servers: { phpantom: { args: ['--stdio'] } } }
    const result = resolveConfig(input)

    expect(result.providerId).toBe('webstack')
    expect(result.servers.phpantom.mode).toBe('path')
    expect(result.servers.typescript.mode).toBe('bundled')
    expect(result.tailwind.queryStrategy).toBe('candidate')
    expect(input).toEqual({ tailwind: { classAttributes: ['class'] }, servers: { phpantom: { args: ['--stdio'] } } })
  })

  it('rejects invalid timeout and empty provider id with stable error code', () => {
    for (const input of [{ timeouts: { completionMs: 0 } }, { providerId: '' }]) {
      expect(() => resolveConfig(input)).toThrowError(WebstackLspError)
      try {
        resolveConfig(input)
      } catch (error) {
        expect(error).toMatchObject({ code: 'LSP_WEBSTACK_CONFIG_INVALID' })
      }
    }
  })

  it('requires an explicit command for path-mode non-PHP servers', () => {
    expect(() => resolveConfig({ servers: { typescript: { mode: 'path' } } })).toThrow('command is required')
    expect(resolveConfig({ servers: { typescript: { mode: 'path', command: '/bin/tsls' } } }).servers.typescript.command).toBe('/bin/tsls')
  })

  it('rejects duplicate and unsafe suffixes', () => {
    expect(() => resolveConfig({ routing: { bladeSuffixes: ['.blade.php', '.BLADE.PHP'] } })).toThrow('duplicate')
    expect(() => resolveConfig({ routing: { bladeSuffixes: ['../php'] } })).toThrow('suffix')
  })

  it('keeps the exported defaults independent from resolved values', () => {
    const result = resolveConfig()
    result.tailwind.classAttributes.push('data-class')
    expect(DEFAULT_CONFIG.tailwind.classAttributes).not.toContain('data-class')
  })
})
