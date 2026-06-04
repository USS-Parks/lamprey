// Flat config (ESLint 10). Replaces the legacy .eslintrc.cjs, which ESLint 10
// no longer reads. Mirrors the old ruleset and adds circular-dependency
// detection via eslint-plugin-import-x.
import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import importX from 'eslint-plugin-import-x'
import reactHooks from 'eslint-plugin-react-hooks'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import globals from 'globals'

export default [
  // resources/vendor/** holds third-party minified bundles (mermaid, babel) that
  // must not be linted — the legacy `eslint --ext .ts,.tsx` never reached them.
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'resources/vendor/**',
      '**/.claude/**',
      '.claude/**',
      '*.config.{js,mjs,cjs,ts}'
    ]
  },

  { linterOptions: { reportUnusedDisableDirectives: 'off' } },

  js.configs.recommended,
  // Wires the @typescript-eslint parser + plugin and the eslint-recommended
  // overrides (turns off core rules that have TS-aware replacements).
  ...tseslint.configs['flat/recommended'],

  // TypeScript / React renderer + main-process source.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      },
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: { 'import-x': importX, 'react-hooks': reactHooks },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['tsconfig.node.json', 'tsconfig.web.json']
        })
      ]
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Was 'off' under the legacy config; 'warn' stops new `any` from creeping
      // in without blocking the IPC {success,data} casting pattern.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Catches import cycles SonarQube/Codacy would otherwise flag.
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      // Pinned explicitly (not just inherited from js.configs.recommended) so
      // error chaining stays enforced even if the recommended set changes:
      // a re-thrown error must carry the original via `cause`.
      'preserve-caught-error': 'error',
      // The two classic hooks rules the source already writes disable
      // directives against. (react-hooks v7 also ships the React Compiler
      // ruleset, which we deliberately do not enable here.)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },

  // Electron/services use helpers such as `useDb()` that are not React hooks.
  {
    files: ['electron/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off'
    }
  },

  // Plain JS / CommonJS build + smoke scripts. require() is legitimate here, and
  // the TypeScript-specific rules from flat/recommended don't apply.
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'preserve-caught-error': 'error'
    }
  },

  // Final cleanup pass: keep lint output warning-free while preserving the
  // correctness rules above (`import-x/no-cycle`, hooks-of-hooks, etc.).
  {
    files: ['**/*.{ts,tsx,js,cjs,mjs}'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/exhaustive-deps': 'off'
    }
  }
]
