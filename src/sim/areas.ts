// Simulated traffic: the hard boundary (data/sim/gap-areas.json).
// Simulated aircraft only ever appear inside these areas. The outlines are
// turned into a 0.5° grid once, blurred so edges fade over about 1°.

export interface GapArea {
  name: string
  /** [lon, lat] points; longitudes may exceed 180 for areas crossing the date line */
  ring: [number, number][]
}

const RES = 0.5
const W = 360 / RES
const H = 180 / RES
const BLUR = 2 // cells (= 1°)

/**
 * Fill the cells whose centres are inside `ring` (even-odd rule), row by row:
 * where the outline crosses a row's latitude, cells between pairs of crossings
 * are inside. Rings may use longitudes past ±180 (date line); those wrap.
 */
function fillRing(raw: Float32Array, ring: [number, number][]) {
  const xs: number[] = []
  const fillSpan = (a: number, b: number) => {
    for (const shift of [-360, 0, 360]) {
      const from = Math.max(0, Math.ceil((a + shift + 180) / RES - 0.5))
      const to = Math.min(W - 1, Math.ceil((b + shift + 180) / RES - 0.5) - 1) // centres strictly before b
      for (let x = from; x <= to; x++) raw[rowStart + x] = 1
    }
  }
  let rowStart = 0
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) * RES
    xs.length = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > lat !== yj > lat) xs.push(((xj - xi) * (lat - yi)) / (yj - yi) + xi)
    }
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)
    rowStart = y * W
    for (let k = 0; k + 1 < xs.length; k += 2) fillSpan(xs[k], xs[k + 1])
  }
}

/** 0..1 "how far inside an area" lookup, 1 = well inside, 0 = outside. */
export class AreaMask {
  private grid: Float32Array

  constructor(areas: GapArea[]) {
    const raw = new Float32Array(W * H)
    for (const a of areas) fillRing(raw, a.ring)
    // Soft edges: box blur (wrapping around in longitude), then shrink so the
    // fade happens just inside the outline.
    const tmp = new Float32Array(W * H)
    const n = 2 * BLUR + 1
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0
        for (let d = -BLUR; d <= BLUR; d++) s += raw[y * W + ((x + d + W) % W)]
        tmp[y * W + x] = s / n
      }
    this.grid = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0
        for (let d = -BLUR; d <= BLUR; d++) s += tmp[Math.min(H - 1, Math.max(0, y + d)) * W + x]
        const v = s / n
        this.grid[y * W + x] = raw[y * W + x] ? Math.min(1, v * 2 - 0.5 + 0.5) : 0
      }
  }

  at(lat: number, lon: number): number {
    const x = Math.floor((((lon + 180) % 360) + 360) % 360 / RES)
    const y = Math.floor((90 - lat) / RES)
    if (y < 0 || y >= H) return 0
    return this.grid[y * W + Math.min(W - 1, x)]
  }
}
