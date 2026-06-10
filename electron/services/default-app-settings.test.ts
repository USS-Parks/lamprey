// SP-1 (Sweet Spot Phase, 2026-06-10) — defaults parity lock.
//
// D1 (SP_BASELINE.md §1): the defaults object was maintained by hand in two
// files and drifted — renderer said `agentMode: 'auto'`, main said `'single'`,
// and main was missing `includePastReasoningInContext` entirely. The main
// process now imports the canonical DEFAULT_APP_SETTINGS; the renderer cannot
// (tsconfig project boundaries: web includes `src/**` only, node includes
// `electron/**` only), so it keeps a literal copy.
//
// This suite locks the copy to the canonical object the same way WC-8 locked
// the sidebar project flow: by reading the renderer SOURCE TEXT and asserting
// each canonical value appears verbatim. A default changed in one place but
// not the other fails here with the exact key named.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_APP_SETTINGS } from './default-app-settings'

const repoRoot = join(__dirname, '..', '..')
const rendererSource = readFileSync(
  join(repoRoot, 'src', 'stores', 'settings-store.ts'),
  'utf-8'
)
const themePresetsSource = readFileSync(
  join(repoRoot, 'src', 'styles', 'theme-presets.ts'),
  'utf-8'
)

/** Escape a string for use inside a RegExp literal. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Assert `key: <value>` appears in the renderer defaults literal. */
function expectRendererDefault(key: string, valueText: string): void {
  const re = new RegExp(`\\b${esc(key)}:\\s*${esc(valueText)}`)
  expect(rendererSource, `renderer settings-store.ts must contain \`${key}: ${valueText}\``).toMatch(re)
}

describe('SP-1 defaults parity — canonical vs renderer literal', () => {
  it('era keys match the §4 decision register', () => {
    expect(DEFAULT_APP_SETTINGS.agentMode).toBe('single')
    expect(DEFAULT_APP_SETTINGS.proofGate).toBe('off')
    expect(DEFAULT_APP_SETTINGS.toolSurface).toBe('full')
    expectRendererDefault('agentMode', "'single'")
    expectRendererDefault('proofGate', "'off'")
    expectRendererDefault('toolSurface', "'full'")
  })

  it('renderer no longer carries the L8 auto default (D1 regression lock)', () => {
    expect(rendererSource).not.toMatch(/agentMode:\s*'auto'/)
  })

  it('scalar defaults match', () => {
    expectRendererDefault('theme', `'${DEFAULT_APP_SETTINGS.theme}'`)
    expectRendererDefault('fontSize', String(DEFAULT_APP_SETTINGS.fontSize))
    expectRendererDefault('defaultModel', `'${DEFAULT_APP_SETTINGS.defaultModel}'`)
    expectRendererDefault('sidebarCollapsed', String(DEFAULT_APP_SETTINGS.sidebarCollapsed))
    expectRendererDefault('artifactPanelWidth', String(DEFAULT_APP_SETTINGS.artifactPanelWidth))
    expectRendererDefault('minimizeToTray', String(DEFAULT_APP_SETTINGS.minimizeToTray))
    expectRendererDefault('autoCheckUpdates', String(DEFAULT_APP_SETTINGS.autoCheckUpdates))
    expectRendererDefault('aiGeneratedTitles', String(DEFAULT_APP_SETTINGS.aiGeneratedTitles))
    expectRendererDefault('agenticCodingMode', String(DEFAULT_APP_SETTINGS.agenticCodingMode))
    expectRendererDefault('agenticCodingComposer', `'${DEFAULT_APP_SETTINGS.agenticCodingComposer}'`)
    expectRendererDefault('snipEnabled', String(DEFAULT_APP_SETTINGS.snipEnabled))
    expectRendererDefault('snipVerbose', String(DEFAULT_APP_SETTINGS.snipVerbose))
    expectRendererDefault('safeSeedLength', String(DEFAULT_APP_SETTINGS.safeSeedLength))
    expectRendererDefault(
      'includePastReasoningInContext',
      String(DEFAULT_APP_SETTINGS.includePastReasoningInContext)
    )
  })

  it('agent roster matches role-for-role', () => {
    for (const [role, model] of Object.entries(DEFAULT_APP_SETTINGS.agentRoster)) {
      expectRendererDefault(role, `'${model}'`)
    }
  })

  it('agentic coding skills match', () => {
    const listText = `[${DEFAULT_APP_SETTINGS.agenticCodingSkills.map((s) => `'${s}'`).join(', ')}]`
    expectRendererDefault('agenticCodingSkills', listText)
  })

  it('theme preset constants match the canonical strings', () => {
    // The renderer references DEFAULT_PRESET_ID / DEFAULT_THEME_MODE rather
    // than literals; lock the constants' definitions instead.
    expect(themePresetsSource).toMatch(
      new RegExp(`DEFAULT_PRESET_ID[^\\n]*=\\s*'${esc(DEFAULT_APP_SETTINGS.themePreset)}'`)
    )
    expect(themePresetsSource).toMatch(
      new RegExp(`DEFAULT_THEME_MODE[^\\n]*=\\s*'${esc(DEFAULT_APP_SETTINGS.themeMode)}'`)
    )
    expect(rendererSource).toMatch(/themePreset:\s*DEFAULT_PRESET_ID/)
    expect(rendererSource).toMatch(/themeMode:\s*DEFAULT_THEME_MODE/)
  })

  it('every canonical key appears in the renderer literal', () => {
    for (const key of Object.keys(DEFAULT_APP_SETTINGS)) {
      expect(rendererSource, `renderer defaults literal is missing key \`${key}\``).toMatch(
        new RegExp(`\\b${esc(key)}:`)
      )
    }
  })
})
