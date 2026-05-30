import type { ThemePreset, ThemePresetId } from '@/lib/types'

export const DEFAULT_PRESET_ID: ThemePresetId = 'lamprey-default'

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'lamprey-default',
    name: 'Lamprey Default',
    source: 'Dark terminal-adjacent base',
    swatch: ['#0d0d0d', '#1f1f1f', '#4a9eff', '#e8e8e8', '#3d9e60'],
    tokens: {
      bgPrimary: '#0d0d0d',
      bgSecondary: '#161616',
      bgTertiary: '#1f1f1f',
      border: '#2a2a2a',
      textPrimary: '#e8e8e8',
      textSecondary: '#888888',
      textMuted: '#444444',
      accent: '#4a9eff',
      accentDim: '#1a3a5c',
      success: '#3d9e60',
      warning: '#c47a2a',
      error: '#c43a3a',
      codeBg: '#111111'
    }
  },
  {
    id: 'arcgis-blue',
    name: 'Lamprey Blue',
    source: 'ArcGIS Blue 3',
    swatch: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
    tokens: {
      bgPrimary: '#0a0d12',
      bgSecondary: '#11151c',
      bgTertiary: '#1a2030',
      border: '#1f2a3a',
      textPrimary: '#e8edf3',
      textSecondary: '#8a96a8',
      textMuted: '#44546a',
      accent: '#6baed6',
      accentDim: '#1a3a5c',
      success: '#3d9e60',
      warning: '#c47a2a',
      error: '#c43a3a',
      codeBg: '#0d1118'
    }
  },
  {
    id: 'arcgis-ember',
    name: 'Lamprey Ember',
    source: 'Esri Orange 1',
    swatch: ['#c65a18', '#f36f20', '#f7975e', '#fbc09b', '#fdd4ba'],
    tokens: {
      bgPrimary: '#100c0a',
      bgSecondary: '#1a1410',
      bgTertiary: '#241a14',
      border: '#2e221a',
      textPrimary: '#f0e8e0',
      textSecondary: '#9a8878',
      textMuted: '#4e3e30',
      accent: '#f36f20',
      accentDim: '#4a2810',
      success: '#3d9e60',
      warning: '#f7975e',
      error: '#c43a3a',
      codeBg: '#130f0d'
    }
  },
  {
    id: 'arcgis-violet',
    name: 'Lamprey Violet',
    source: 'Esri Purple 1',
    swatch: ['#57318c', '#7b5ba9', '#a085c6', '#c4afe2', '#d6c4f1'],
    tokens: {
      bgPrimary: '#0d0a14',
      bgSecondary: '#15101e',
      bgTertiary: '#1f1828',
      border: '#2a2236',
      textPrimary: '#e8e2f0',
      textSecondary: '#9286a8',
      textMuted: '#4a3e60',
      accent: '#a085c6',
      accentDim: '#3d2860',
      success: '#3d9e60',
      warning: '#c47a2a',
      error: '#c43a3a',
      codeBg: '#110d1a'
    }
  },
  {
    id: 'arcgis-inferno',
    name: 'Lamprey Inferno',
    source: 'ArcGIS Inferno',
    swatch: ['#520d8e', '#bc2e9a', '#ff5c6a', '#ffb71b', '#ffff64'],
    tokens: {
      bgPrimary: '#0e0810',
      bgSecondary: '#170f1a',
      bgTertiary: '#221726',
      border: '#2e2030',
      textPrimary: '#f0e0e8',
      textSecondary: '#a08090',
      textMuted: '#503040',
      accent: '#ff5c6a',
      accentDim: '#5c1828',
      success: '#3d9e60',
      warning: '#ffb71b',
      error: '#c43a3a',
      codeBg: '#110a14'
    }
  },
  {
    id: 'arcgis-magma',
    name: 'Lamprey Magma',
    source: 'ArcGIS Magma',
    swatch: ['#481793', '#b233b9', '#ff57a5', '#ffae85', '#ffffd1'],
    tokens: {
      bgPrimary: '#0a0814',
      bgSecondary: '#110f1c',
      bgTertiary: '#1a1828',
      border: '#25223a',
      textPrimary: '#f0e0ec',
      textSecondary: '#9080a0',
      textMuted: '#483a55',
      accent: '#ff57a5',
      accentDim: '#5c1c48',
      success: '#3d9e60',
      warning: '#ffae85',
      error: '#c43a3a',
      codeBg: '#0d0a18'
    }
  },
  {
    id: 'arcgis-viridis',
    name: 'Lamprey Viridis',
    source: 'ArcGIS Viridis',
    swatch: ['#6058be', '#419ecb', '#2cdcc6', '#6fff99', '#ffff37'],
    tokens: {
      bgPrimary: '#08110e',
      bgSecondary: '#0e1a17',
      bgTertiary: '#162624',
      border: '#1f3030',
      textPrimary: '#e0f0ec',
      textSecondary: '#7898a0',
      textMuted: '#3a5050',
      accent: '#2cdcc6',
      accentDim: '#105550',
      success: '#3d9e60',
      warning: '#c47a2a',
      error: '#c43a3a',
      codeBg: '#0a1410'
    }
  }
]

export function getPreset(id: ThemePresetId | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0]
}
