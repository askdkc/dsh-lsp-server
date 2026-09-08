import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/e2e/**/*.e2e.ts'], testTimeout: 60000, hookTimeout: 20000, fileParallelism: false } })
