import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {
  pool: 'forks', include: ['test/**/*.spec.ts'], testTimeout: 15000, hookTimeout: 15000,
  coverage: { provider: 'v8', include: ['src/**/*.ts'], reporter: ['text', 'json-summary'] },
} })
