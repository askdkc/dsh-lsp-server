import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    provider: 'src/provider.ts',
    'extra-tool': 'src/extra-tool.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
