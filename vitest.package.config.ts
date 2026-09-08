import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/package/**/*.spec.ts'], testTimeout: 120000, hookTimeout: 10000 } })
