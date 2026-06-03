import { defineConfig } from 'vitest/config'

// Prompt 12: coverage is enabled with a low floor (baseline minus 2pp) as a
// regression guard, NOT a quality target. The threshold catches "someone
// deleted a major test file" or "a refactor stopped exercising a service"
// — it does NOT push every PR to push the number up. The floor is global,
// not per-file. Raising the floor is a separate, intentional doc-only
// commit; renderer code (most of `src/`) currently shows 0% because the
// test environment is node-only — jsdom-backed renderer tests are the
// scope of Prompt 5 of the audit-remediation roster.
export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
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
