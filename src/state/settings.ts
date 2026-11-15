import { useEffect, useState } from 'react'

export type UnitSystem = 'aviation' | 'metric' | 'imperial'

export interface Settings {
  units: UnitSystem
  /** Keep drawing real flights after they leave receiver coverage (estimated) */
  ghostsContinued: boolean
  /** Draw yesterday's flights where there's no live coverage (simulated) */
  ghostsSimulated: boolean
}

const DEFAULTS: Settings = { units: 'aviation', ghostsContinued: true, ghostsSimulated: true }
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
