import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/package/**/*.spec.ts'], testTimeout: 30000, hookTimeout: 10000 } })
