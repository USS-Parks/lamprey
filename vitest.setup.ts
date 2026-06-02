// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) on
// vitest's expect. Safe to load in the node environment too — the matchers are
// only evaluated when called, which happens only in jsdom-environment tests.
import '@testing-library/jest-dom/vitest'
