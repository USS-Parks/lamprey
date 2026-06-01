import { useEffect, useState } from 'react'

// Returns whether the given CSS media query currently matches. Updates
// reactively as the viewport changes. SSR-safe — returns false during the
// first render outside a browser, then re-runs once the effect fires.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}

// Narrow viewport breakpoint for the responsive right-panel drawer. Below
// this width the docked panel becomes a slide-over instead of shrinking
// the chat column.
export const NARROW_VIEWPORT_QUERY = '(max-width: 960px)'
