// Global vitest setup. Registers @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, …) on vitest's `expect`. The import
// only calls `expect.extend(...)` — it touches no DOM globals — so it is safe
// to load for node-environment test files too; the matchers are simply unused
// there.
import '@testing-library/jest-dom/vitest'
