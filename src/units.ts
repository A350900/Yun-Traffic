import type { UnitSystem } from './state/settings'

// All values arrive in aviation units (feet, knots, ft/min) or km for
// distances, and are converted for display here.

const n0 = (n: number) => Math.round(n).toLocaleString()

export const UNIT_SYSTEMS: { id: UnitSystem; label: string; hint: string }[] = [
  { id: 'aviation', label: 'Aviation', hint: 'knots · feet / flight levels · nautical miles' },
  { id: 'metric', label: 'Metric', hint: 'km/h · metres · kilometres' },
  { id: 'imperial', label: 'Imperial', hint: 'mph · feet · miles' },
]

/** Altitude in feet (-1 = on ground). */
export function fmtAltitude(ft: number | null, u: UnitSystem) {
  if (ft === -1) return 'On ground'
  if (ft == null) return '—'
  if (u === 'metric') return `${n0(ft * 0.3048)} m`
  if (u === 'aviation' && ft >= 18000) return `FL${Math.round(ft / 100)}`
  return `${n0(ft)} ft`
}

/** Speed in knots. */
export function fmtSpeed(kt: number | null, u: UnitSystem) {
  if (kt == null) return '—'
  if (u === 'metric') return `${n0(kt * 1.852)} km/h`
  if (u === 'imperial') return `${n0(kt * 1.15078)} mph`
  return `${n0(kt)} kt`
}

/** Vertical rate in ft/min. */
export function fmtVerticalRate(fpm: number | null, u: UnitSystem) {
  if (fpm == null) return '—'
  if (u === 'metric') return `${(fpm * 0.00508).toFixed(1)} m/s`
  return `${n0(fpm)} ft/min`
}

/** Distance in km. */
export function fmtDistance(km: number, u: UnitSystem) {
  if (u === 'aviation') return `${n0(km / 1.852)} nm`
  if (u === 'imperial') return `${n0(km / 1.609344)} mi`
  return `${n0(km)} km`
}

/** Altitude legend labels for the flight-path colours. */
export function altitudeLegend(u: UnitSystem): [string, string, string] {
  return u === 'metric' ? ['Ground', '6,100 m', '12,200 m+'] : ['Ground', '20,000 ft', '40,000 ft+']
}
