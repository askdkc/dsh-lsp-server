import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { maxWorkers: 4, include: ['tests/unit/**/*.spec.ts', 'tests/integration/**/*.spec.ts'], hookTimeout: 20000 } })
