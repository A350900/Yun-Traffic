// Central place to switch the map look. Change `ACTIVE_THEME` (or add new
// entries) and the map style + logo variant follow automatically.

export type ThemeName = 'dark' | 'light'

interface ThemeConfig {
  /** OpenFreeMap style URL */
  mapStyle: string
  /** Logo to show over the map: light text for dark maps, dark text for light maps */
  logo: string
  /** Shown while tiles load */
  background: string
}

export const THEMES: Record<ThemeName, ThemeConfig> = {
  dark: {
    mapStyle: 'https://tiles.openfreemap.org/styles/dark',
    logo: '/brand/logo-light-v2.png',
    background: '#0e0e10',
  },
  light: {
    mapStyle: 'https://tiles.openfreemap.org/styles/positron',
    logo: '/brand/logo-dark.png',
    background: '#f2f3f0',
  },
}

export const ACTIVE_THEME: ThemeName = 'dark'
