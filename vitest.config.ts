import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@data': fileURLToPath(new URL('./src/data', import.meta.url)),
      '@web': fileURLToPath(new URL('./src/web', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    // crypto (PBKDF2 310 000 rounds) and Monte Carlo runs are CPU-heavy: generous time limit, so a busy machine does not fail them
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/data/**'],
      exclude: ['src/data/fetch.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
})
