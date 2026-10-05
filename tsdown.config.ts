import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    lsp: 'src/lsp.ts',
    'tool-lsp': 'src/tool-lsp.ts',
    provider: 'src/provider.ts',
    'extra-tool': 'src/extra-tool.ts',
    'cli/doctor': 'src/cli/doctor.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
})
