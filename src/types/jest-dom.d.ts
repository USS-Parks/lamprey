// Makes @testing-library/jest-dom matcher types (toBeInTheDocument, …) visible
// to the renderer tsconfig. The side-effect import augments vitest's
// `Assertion`/`AsymmetricMatchersContaining` interfaces. Runtime registration
// of the matchers happens separately in `vitest.setup.ts`.
import '@testing-library/jest-dom/vitest'
