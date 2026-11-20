import { useEffect, useState } from 'react'

export type UnitSystem = 'aviation' | 'metric' | 'imperial'

export interface Settings {
  units: UnitSystem
  /** simulated traffic (beta): fill gaps in live coverage with illustrative flights */
  simTraffic: boolean
  /** simulated traffic: outline the areas where it's allowed */
  simShowAreas: boolean
}

const DEFAULTS: Settings = { units: 'aviation', simTraffic: false, simShowAreas: false }
const KEY = 'yun.settings'

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

/** App settings, remembered in this browser. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  }, [settings])
  return [settings, setSettings] as const
}
