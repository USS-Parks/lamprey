// Makes the @testing-library/jest-dom matchers (toBeInTheDocument, etc.) known
// to vitest's `expect` types across the renderer test suite. The runtime
// registration happens in vitest.setup.ts; this brings in the matching types.
import '@testing-library/jest-dom/vitest'
