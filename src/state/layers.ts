import { useEffect, useState } from 'react'

/** Map overlays the user can switch on and off from the Layers menu. */
export interface LayerSettings {
  dayNight: boolean
}

const DEFAULTS: LayerSettings = { dayNight: true }
const KEY = 'yun.layers'

function load(): LayerSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

/** Layer toggles, remembered in this browser between visits. */
export function useLayerSettings() {
  const [layers, setLayers] = useState<LayerSettings>(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layers))
    } catch {
      /* storage unavailable (private mode etc.) — settings just won't persist */
    }
  }, [layers])
  return [layers, setLayers] as const
}
