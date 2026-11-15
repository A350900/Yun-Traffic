// Simulated traffic: world regions used for statistics and the traffic model.
// Simple lat/lon boxes, checked in order (first match wins); good enough for
// counting traffic, not for borders.

export interface Region {
  id: string
  name: string
  /** [south, west, north, east] */
  box: [number, number, number, number]
}

export const REGIONS: Region[] = [
  { id: 'jpkr', name: 'Japan & Korea', box: [30, 124, 46, 146] },
  { id: 'natl', name: 'North Atlantic', box: [20, -60, 66, -10] },
  { id: 'npac', name: 'North Pacific', box: [10, 150, 60, 180] },
  { id: 'npac2', name: 'North Pacific', box: [10, -180, 60, -130] },
  { id: 'europe', name: 'Europe', box: [35, -25, 72, 45] },
  { id: 'mideast', name: 'Middle East', box: [12, 34, 42, 62] },
  { id: 'china', name: 'China', box: [18, 73, 54, 135] },
  { id: 'russia', name: 'Russia & Central Asia', box: [40, 45, 78, 180] },
  { id: 'sasia', name: 'South Asia', box: [5, 60, 37, 92] },
  { id: 'seasia', name: 'Southeast Asia', box: [-11, 92, 22, 141] },
  { id: 'africa', name: 'Africa', box: [-36, -20, 37, 52] },
  { id: 'namerica', name: 'North America', box: [7, -170, 75, -50] },
  { id: 'samerica', name: 'South America', box: [-56, -92, 13, -32] },
  { id: 'oceania', name: 'Oceania', box: [-50, 110, 0, 180] },
]

export const OTHER_REGION = { id: 'other', name: 'Other (oceans, polar)' }

export function regionOf(lat: number, lon: number): string {
  for (const r of REGIONS) {
    const [s, w, n, e] = r.box
    if (lat >= s && lat <= n && lon >= w && lon <= e) return r.id === 'npac2' ? 'npac' : r.id
  }
  return OTHER_REGION.id
}

/** Grid cell used for coverage (2° x 2°). */
export const CELL_DEG = 2
export const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)},${Math.floor(lon / CELL_DEG)}`
