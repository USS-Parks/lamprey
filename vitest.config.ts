import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // The React plugin transforms JSX/TSX for renderer component tests; the `@`
  // alias mirrors tsconfig.web.json's paths so `@/...` imports resolve.
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    // Default to node. Renderer tests that need a DOM opt in per-file with a
    // `// @vitest-environment jsdom` docblock — keeps the electron/** suite fast.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15_000,
    coverage: {
      // Baseline collection only — no failing threshold yet (Prompt 12 adds the
      // CI gate). Run with `npx vitest run --coverage`.
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', '**/types.ts', 'electron/preload.ts']
    }
  }
})
