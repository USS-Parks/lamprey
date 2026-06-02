// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSettingsStore } from './settings-store'

const setMock = vi.fn()
const getMock = vi.fn()

beforeEach(() => {
  setMock.mockReset().mockResolvedValue({ success: true, data: null })
  getMock.mockReset().mockResolvedValue({ success: true, data: { fontSize: 18 } })
  ;(window as unknown as { api: unknown }).api = {
    settings: { set: setMock, get: getMock }
  }
  // Reset to a known baseline so cross-test order doesn't matter.
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, fontSize: 14 }, loaded: false }))
})

describe('settings-store', () => {
  it('updateSettings merges the partial into state and persists it via IPC', async () => {
    await useSettingsStore.getState().updateSettings({ fontSize: 16 })
    expect(useSettingsStore.getState().settings.fontSize).toBe(16)
    expect(setMock).toHaveBeenCalledWith({ fontSize: 16 })
  })

  it('updateSettings leaves untouched fields intact', async () => {
    const before = useSettingsStore.getState().settings.defaultModel
    await useSettingsStore.getState().updateSettings({ minimizeToTray: true })
    const after = useSettingsStore.getState().settings
    expect(after.minimizeToTray).toBe(true)
    expect(after.defaultModel).toBe(before)
  })

  it('loadSettings merges persisted values onto the defaults and marks loaded', async () => {
    await useSettingsStore.getState().loadSettings()
    expect(getMock).toHaveBeenCalled()
    expect(useSettingsStore.getState().settings.fontSize).toBe(18) // from persisted data
    expect(useSettingsStore.getState().loaded).toBe(true)
  })
})
