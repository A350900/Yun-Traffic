// Simulated traffic: "which simulated flights are in the air at time t, and where".
//
// Flights move along the great circle between their airports at constant
// speed. Near airports they're hidden (no fake takeoffs/landings): invisible
// within SIM_CONFIG.hideWithinNm, fading in until SIM_CONFIG.fadeUntilNm.

import { SIM_CONFIG } from './config'
import { buildDay, prepareRoutes, type PreparedRoute, type SimFlight } from './schedule'
import type { SimData } from './types'

const R = Math.PI / 180
const DAY_MS = 86_400_000
/** Longest flight we ever expect (ms); bounds how far back to look for airborne flights. */
const MAX_FLIGHT_MS = 22 * 3600_000

export interface SimPosition {
  flight: SimFlight
  route: PreparedRoute
  lat: number
  lon: number
  /** degrees true, towards the destination */
  track: number
  altitudeFt: number
  speedKt: number
  /** 0..1 progress along the route */
  progress: number
  /** 0 = hidden (near an airport) .. 1 = fully visible */
  visibility: number
}

const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export class SimModel {
  readonly routes: PreparedRoute[]
  private data: SimData
  private days = new Map<string, SimFlight[]>()
  constructor(data: SimData) {
    this.data = data
    this.routes = prepareRoutes(data)
  }

  get airlines() {
    return this.data.routes.airlines
  }
  get aircraftNames() {
    return this.data.routes.aircraft
  }

  /** Timetable for a local date (cached). */
  day(key: string): SimFlight[] {
    let d = this.days.get(key)
    if (!d) {
      d = buildDay(this.routes, this.data, key)
      this.days.set(key, d)
      if (this.days.size > 6) this.days.delete(this.days.keys().next().value!)
    }
    return d
  }

  /** Flights in the air at `t` (epoch ms). Local dates span UTC date -2..+1. */
  *airborne(t: number): Generator<SimFlight> {
    for (let k = -2; k <= 1; k++) {
      for (const f of this.day(dateKey(t + k * DAY_MS))) {
        if (f.dep > t) break // sorted by departure
        if (f.arr >= t && t - f.dep <= MAX_FLIGHT_MS) yield f
      }
    }
  }

  countAirborne(t: number): number {
    let n = 0
    for (const _ of this.airborne(t)) n++
    return n
  }

  /** Position of a flight at time t. */
  position(f: SimFlight, t: number): SimPosition {
    const r = this.routes[f.route]
    const progress = Math.min(1, Math.max(0, (t - f.dep) / (f.arr - f.dep)))
    const [lat, lon] = along(r.depLat, r.depLon, r.arrLat, r.arrLon, progress)
    const nmFrom = (progress * r.km) / 1.852
    const nmTo = ((1 - progress) * r.km) / 1.852
    const near = Math.min(nmFrom, nmTo)
    const { hideWithinNm: h, fadeUntilNm: fu } = SIM_CONFIG
    const visibility = Math.min(1, Math.max(0, (near - h) / (fu - h)))
    return {
      flight: f,
      route: r,
      lat,
      lon,
      track: bearing(lat, lon, r.arrLat, r.arrLon),
      altitudeFt: f.altitudeFt,
      speedKt: Math.round(f.speedKmh / 1.852),
      progress,
      visibility,
    }
  }
}

/** Point a fraction `f` of the way along the great circle from a to b ([lat, lon]). */
export function along(lat1: number, lon1: number, lat2: number, lon2: number, f: number): [number, number] {
  const p1 = lat1 * R
  const p2 = lat2 * R
  const l1 = lon1 * R
  const l2 = lon2 * R
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2))
  if (d < 1e-9) return [lat1, lon1]
  const A = Math.sin((1 - f) * d) / Math.sin(d)
  const B = Math.sin(f * d) / Math.sin(d)
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2)
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2)
  const z = A * Math.sin(p1) + B * Math.sin(p2)
  return [Math.atan2(z, Math.hypot(x, y)) / R, Math.atan2(y, x) / R]
}

/** Initial compass bearing from a to b (degrees). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const y = Math.sin((lon2 - lon1) * R) * Math.cos(lat2 * R)
  const x = Math.cos(lat1 * R) * Math.sin(lat2 * R) - Math.sin(lat1 * R) * Math.cos(lat2 * R) * Math.cos((lon2 - lon1) * R)
  return (Math.atan2(y, x) / R + 360) % 360
}
