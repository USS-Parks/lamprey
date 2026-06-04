// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settings-store'

// window.api is the preload bridge; absent under test. Stub just the
// settings surface this store touches. Cast through `unknown` so we don't
// have to satisfy the full Window['api'] type for two methods.
const get = vi.fn()
const set = vi.fn()
function installApiStub() {
  ;(window as unknown as Record<string, unknown>).api = { settings: { get, set } }
}

const initial = useSettingsStore.getInitialState()

beforeEach(() => {
  get.mockReset()
  set.mockReset().mockResolvedValue({ success: true, data: null })
  installApiStub()
  useSettingsStore.setState(initial, true)
})

describe('useSettingsStore.loadSettings', () => {
  it('merges persisted settings over the defaults and marks loaded', async () => {
    get.mockResolvedValue({
      success: true,
      data: { fontSize: 18, defaultModel: 'qwen3-coder-plus' }
    })
    await useSettingsStore.getState().loadSettings()
    const s = useSettingsStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.settings.fontSize).toBe(18)
    expect(s.settings.defaultModel).toBe('qwen3-coder-plus')
    // A field not present in the persisted blob keeps its default.
    expect(s.settings.theme).toBe('dark')
  })

  it('leaves state untouched (loaded stays false) when the IPC call fails', async () => {
    get.mockResolvedValue({ success: false, error: 'boom' })
    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState().loaded).toBe(false)
  })
})

describe('useSettingsStore.updateSettings', () => {
  it('applies the partial to local state and persists exactly that partial', async () => {
    await useSettingsStore.getState().updateSettings({ fontSize: 22 })
    expect(useSettingsStore.getState().settings.fontSize).toBe(22)
    expect(set).toHaveBeenCalledWith({ fontSize: 22 })
  })
})

describe('useSettingsStore.toggleThemeMode', () => {
  it('flips the theme mode and persists the flipped value', async () => {
    const before = useSettingsStore.getState().settings.themeMode
    const expected = before === 'dark' ? 'light' : 'dark'
    await useSettingsStore.getState().toggleThemeMode()
    expect(useSettingsStore.getState().settings.themeMode).toBe(expected)
    expect(set).toHaveBeenCalledWith({ themeMode: expected })
  })
})
