// @vitest-environment jsdom
//
// Proves the renderer test pipeline works end-to-end: jsdom + @vitejs/plugin-react
// (JSX transform) + @testing-library/react + @testing-library/jest-dom matchers +
// the `@/` alias + zustand hook reactivity. Prompts 8 and 11 build their renderer
// tests on this foundation.
import { describe, it, expect } from 'vitest'
import { render, screen, renderHook, act } from '@testing-library/react'
import { useAgentStore } from '@/stores/agent-store'

describe('renderer test foundation', () => {
  it('renders JSX and matches a jest-dom matcher', () => {
    render(<div data-testid="probe">foundation ok</div>)
    expect(screen.getByTestId('probe')).toBeInTheDocument()
    expect(screen.getByTestId('probe')).toHaveTextContent('foundation ok')
  })

  it('drives a zustand store hook reactively through act()', () => {
    const { result } = renderHook(() => useAgentStore((s) => s.mode))
    expect(result.current).toBe('single')
    act(() => useAgentStore.getState().setMode('multi'))
    expect(result.current).toBe('multi')
    act(() => useAgentStore.getState().setMode('single')) // reset shared singleton
  })
})
