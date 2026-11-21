import { useEffect, useState } from 'react'

export type UnitSystem = 'aviation' | 'metric' | 'imperial'

export type AppMode = 'tracking' | 'encyclopedia'

export interface Settings {
  /** Tracking (live and simulated traffic) or Encyclopedia (the map and its reference layers, no traffic) */
  mode: AppMode
  units: UnitSystem
  /** simulated traffic (beta): fill gaps in live coverage with illustrative flights */
  simTraffic: boolean
  /** simulated traffic: outline the areas where it's allowed */
  simShowAreas: boolean
}

const DEFAULTS: Settings = { mode: 'tracking', units: 'aviation', simTraffic: true, simShowAreas: false }
const KEY = 'yun.settings'
/** Bump to reset settings whose default changed (2: simulated traffic on by default). */
const VERSION = 2

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if ((stored.v ?? 1) < 2) delete stored.simTraffic
    delete stored.v
    return { ...DEFAULTS, ...stored }
  } catch {
    return DEFAULTS
  }
}

/** App settings, remembered in this browser. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...settings, v: VERSION }))
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  }, [settings])
  return [settings, setSettings] as const
}
