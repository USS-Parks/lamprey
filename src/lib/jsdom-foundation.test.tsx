// @vitest-environment jsdom
//
// Proves the renderer-test foundation works end to end: jsdom environment +
// @testing-library/react render + @testing-library/jest-dom matchers. Prompts
// that add real component tests (e.g. SideChatPanel) depend on this stack.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>
}

describe('renderer-test foundation', () => {
  it('renders a component into jsdom and matches with jest-dom', () => {
    render(<Greeting name="Lamprey" />)
    expect(screen.getByText('Hello, Lamprey')).toBeInTheDocument()
  })
})
