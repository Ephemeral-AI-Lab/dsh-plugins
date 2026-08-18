import { defineConfig } from 'vitest/config'

/** Resolve DHS package names to the shared harness source graph for focused plugin tests. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
