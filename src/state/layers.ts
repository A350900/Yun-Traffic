import { useEffect, useState } from 'react'
import type { RadarStyle } from '../layers/radarStyle'

/** Map overlays the user can switch on and off (Layers menu / Weather panel). */
export interface LayerSettings {
  dayNight: boolean
  radar: boolean
  radarStyle: RadarStyle
  radarOpacity: number
  /** pins for the busiest airports */
  airports: boolean
  /** Encyclopedia: each country's main airlines */
  countryAirlines: boolean
  /** en-route control boundaries (FIRs) */
  firBoundaries: boolean
}

import type { AppMode } from './settings'

/** Each mode keeps its own layer choices. Encyclopedia: everything on except weather. */
const DEFAULTS: Record<AppMode, LayerSettings> = {
  tracking: { dayNight: true, radar: false, radarStyle: 'cartoon', radarOpacity: 0.85, firBoundaries: false, airports: true, countryAirlines: false },
  encyclopedia: { dayNight: true, radar: false, radarStyle: 'cartoon', radarOpacity: 0.85, firBoundaries: true, airports: true, countryAirlines: true },
}
const KEYS: Record<AppMode, string> = { tracking: 'yun.layers', encyclopedia: 'yun.layers.encyclopedia' }
/** Bump to reset layers whose default changed (2: control boundaries back to off in Tracking). */
const VERSION = 2

function load(mode: AppMode): LayerSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEYS[mode]) ?? '{}')
    if (mode === 'tracking' && (stored.v ?? 1) < 2) delete stored.firBoundaries
    delete stored.v
    return { ...DEFAULTS[mode], ...stored }
  } catch {
    return DEFAULTS[mode]
  }
}

/** Layer toggles for one mode, remembered in this browser between visits. */
export function useLayerSettings(mode: AppMode) {
  const [layers, setLayers] = useState<LayerSettings>(() => load(mode))
  useEffect(() => {
    try {
      localStorage.setItem(KEYS[mode], JSON.stringify({ ...layers, v: VERSION }))
    } catch {
      /* storage unavailable (private mode etc.) — settings just won't persist */
    }
  }, [layers, mode])
  return [layers, setLayers] as const
}
