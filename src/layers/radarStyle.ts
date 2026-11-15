// Colours for the weather radar. Shared by the tile painter (worker) and the
// legend, so the legend always matches what's on the map.

export type RadarStyle = 'cartoon' | 'realistic'

export interface RadarBand {
  label: string
  /** What it means, for the legend tooltip */
  hint: string
  rgb: [number, number, number]
  /** 0–1, baked into the tile */
  alpha: number
}

/**
 * Cartoon palette: cool tones that read clearly on the dark plum map and
 * stay distinct from the pink aircraft. Intense cells switch to warm amber.
 */
export const CARTOON_BANDS: RadarBand[] = [
  { label: 'Light', hint: 'Drizzle, light rain or snow', rgb: [57, 208, 196], alpha: 0.32 },
  { label: 'Moderate', hint: 'Steady rain', rgb: [63, 167, 255], alpha: 0.5 },
  { label: 'Heavy', hint: 'Heavy rain', rgb: [118, 108, 255], alpha: 0.66 },
  { label: 'Intense', hint: 'Thunderstorms, hail', rgb: [255, 201, 77], alpha: 0.88 },
]

/** Outline drawn around rain areas in the cartoon style */
export const CARTOON_OUTLINE: { rgb: [number, number, number]; alpha: number } = { rgb: [140, 240, 230], alpha: 0.75 }

/** Approximate RainViewer "Universal Blue" colours, for the realistic legend. */
export const REALISTIC_LEGEND = ['#d6c88f', '#88ddee', '#00a3e0', '#005588', '#ffee00', '#ffaa00']

/**
 * RainViewer's Universal Blue colour → our band (0 = nothing).
 *   tan (translucent), pale cyan → light
 *   mid blue                     → moderate
 *   deep blue                    → heavy
 *   yellow/orange/red/…          → intense
 */
export function bandForColor(r: number, g: number, b: number, a: number): number {
  if (a < 80) return 0 // faintest drizzle: mostly speckle, leave it out
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 510
  if (a < 255) return 1 // the drizzle shades are the only translucent ones
  if (max === min) return l > 0.5 ? 4 : 1 // greys/white at the very top of the scale
  let h: number
  const d = max - min
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  if (h >= 170 && h <= 230) return l >= 0.6 ? 1 : l >= 0.3 ? 2 : 3 // blues: lighter = less intense
  if (h >= 35 && h <= 60 && l > 0.6 && (r + g) / 2 - b < 90) return 1 // pale tan
  return 4 // warm colours, magenta, etc.
}
