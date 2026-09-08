import { Context } from '@deepseek-ai/cordis'
import Lsp from '@deepseek-ai/dsh-lsp'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import * as provider from '../../src/provider.js'
import type { Config } from '../../src/config.js'

export async function harness(root: string, config: Config = {}) {
  const ctx = new Context()
  try {
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(LocalSubprocessService)
    await ctx.plugin(Lsp)
    const plugin = ctx.plugin(provider, { servers: { phpantom: { enabled: false } }, tailwind: { enabled: false }, ...config })
    await plugin
    return { ctx, plugin, lsp: ctx.get('lsp')!, extra: ctx.get('webstackLsp')!, dispose: () => ctx.fiber.dispose() }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
