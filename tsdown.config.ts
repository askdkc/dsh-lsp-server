import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
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
