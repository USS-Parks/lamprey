import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Prompt 12: coverage is enabled with a low floor (baseline minus 2pp) as a
// regression guard, NOT a quality target. The threshold catches "someone
// deleted a major test file" or "a refactor stopped exercising a service"
// — it does NOT push every PR to push the number up. The floor is global,
// not per-file. Raising the floor is a separate, intentional doc-only commit.
//
// Audit Remediation Prompt 5 added the renderer-test foundation: the `@`
// alias (so `src/` tests can import `@/...` at runtime, not just as erased
// type-only imports) and a jest-dom setup file. The default environment stays
// `node`; renderer tests that need the DOM opt in per-file with a
// `// @vitest-environment jsdom` docblock (vitest 4 removed
// `environmentMatchGlobs`). Most Zustand-store logic needs no DOM and runs
// under node directly.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src'),
      '@assets': resolve('ASSETS')
    }
  },
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'electron/preload.ts',
        'electron/main.ts',
        'electron/ipc/index.ts',
        'out/**',
        'dist/**',
        'scripts/**',
        'resources/**',
        'node_modules/**'
      ],
      // Floors captured during Prompt 12 (baseline 15.63 / 14.58 / 11.85 /
      // 16.01 %, rounded down then minus 2pp). Bump these in a deliberate
      // commit if the floor moves up.
      thresholds: {
        statements: 13,
        branches: 12,
        functions: 9,
        lines: 14
      }
    }
  }
})
