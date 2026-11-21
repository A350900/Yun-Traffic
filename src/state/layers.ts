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
  /** en-route control boundaries (FIRs) */
  firBoundaries: boolean
}

const DEFAULTS: LayerSettings = { dayNight: true, radar: false, radarStyle: 'cartoon', radarOpacity: 0.85, firBoundaries: false, airports: true }
const KEY = 'yun.layers'
/** Bump to reset layers whose default changed (2: control boundaries back to off). */
const VERSION = 2

function load(): LayerSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if ((stored.v ?? 1) < 2) delete stored.firBoundaries
    delete stored.v
    return { ...DEFAULTS, ...stored }
  } catch {
    return DEFAULTS
  }
}

/** Layer toggles, remembered in this browser between visits. */
export function useLayerSettings() {
  const [layers, setLayers] = useState<LayerSettings>(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...layers, v: VERSION }))
    } catch {
      /* storage unavailable (private mode etc.) — settings just won't persist */
    }
  }, [layers])
  return [layers, setLayers] as const
}
