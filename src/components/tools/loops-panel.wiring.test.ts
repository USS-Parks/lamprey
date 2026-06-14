import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// LP-9 — source-lock the loops observation UI wiring (WC-8 / era-chrome
// pattern): these read the source text so the pill + panel + ToolId stay wired.

const root = join(__dirname, '..', '..', '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf-8')

describe('LP-9 loops UI wiring', () => {
  it("ui-store ToolId includes 'loop'", () => {
    expect(read('src/stores/ui-store.ts')).toMatch(/\|\s*'loop'/)
  })

  it('ToolsPanel imports + renders + labels the loop panel', () => {
    const src = read('src/components/tools/ToolsPanel.tsx')
    expect(src).toMatch(/import \{ LoopsPanel \}/)
    expect(src).toMatch(/case 'loop':[\s\S]*?<LoopsPanel \/>/)
    expect(src).toMatch(/loop: 'Loops'/)
  })

  it('RightPanelHome registers the Loops pill', () => {
    const src = read('src/components/artifacts/RightPanelHome.tsx')
    expect(src).toMatch(/id: 'loop'/)
    expect(src).toMatch(/label: 'Loops'/)
  })

  it('LoopsPanel consumes the loops store + live loop events', () => {
    const src = read('src/components/tools/panels/LoopsPanel.tsx')
    expect(src).toMatch(/useLoopsStore/)
    expect(src).toMatch(/onLoopEvent/)
    expect(src).toMatch(/listBacklog/)
  })
})
