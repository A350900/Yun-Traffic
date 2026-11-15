// Simulated traffic: the daily virtual timetable.
//
// For a given local date, every route gets a number of flights based on how
// big its two airports are (number of routes) and its distance, adjusted for
// the month and weekday. Each flight departs at a local time drawn from the
// departure-time profile for its kind of route (short-haul daytime curve,
// long-haul banks such as Europe -> North America by day). Deterministic:
// the same date always produces the same timetable.

import { SIM_CONFIG, type SizeClass } from './config'
import { hash, pickWeighted, poisson, rng } from './random'
import type { SimData } from './types'

const R = Math.PI / 180
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a = Math.sin(((lat2 - lat1) * R) / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(((lon2 - lon1) * R) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

// ---------------------------------------------------------------- classification

const MIDDLE_EAST = new Set(['AE', 'QA', 'SA', 'KW', 'BH', 'OM', 'IR', 'IQ', 'JO', 'LB', 'IL', 'SY', 'YE'])
const NORTH_AMERICA = new Set(['US', 'CA', 'MX'])

/** Which monthly-factor group an airport belongs to (keys of traffic-model.json "monthly"). */
export function seasonGroup(country: string, lat: number, lon: number): string {
  if (country === 'CN') return 'china'
  if (NORTH_AMERICA.has(country)) return 'northAmerica'
  if (MIDDLE_EAST.has(country)) return 'middleEast'
  if (lat < -10) return 'southernHemisphere'
  if (lat > 34 && lon > -25 && lon < 45) return 'europe'
  return 'rest'
}

const isAsia = (lat: number, lon: number) => lon > 60 && lat > -11
const WIDE = /^(A3[0-5]|A38|B74|B76|B77|B78|MD11|DC10|IL96|IL86|L101|A400|C17)/
const TURBOPROP = /^(AT[4-7]|DH8|DHC|SF34|JS[0-9]|B190|F50|E120|C208|A748|SB20|D328|L410|BE[0-9]|PC12|SW4|SH36|AN2|AN24|AN26|Y12|MA60|DO28)/
const REGIONAL = /^(CRJ|E13|E14|E17|E75|E19|E29|ERJ|F70|F100|B46|RJ|AJ27|SU95)/

export function sizeClass(type: string): SizeClass {
  if (WIDE.test(type)) return 'widebody'
  if (TURBOPROP.test(type)) return 'turboprop'
  if (REGIONAL.test(type)) return 'regional'
  return 'narrowbody'
}

function defaultType(km: number, rand: () => number): string {
  if (km < 350) return 'AT76'
  if (km < 900) return rand() < 0.5 ? 'E190' : 'CRJ9'
  if (km < 4500) return rand() < 0.5 ? 'A320' : 'B738'
  return ['B77W', 'A359', 'B789', 'A333'][Math.floor(rand() * 4)]
}

// ---------------------------------------------------------------- prepared routes

export interface PreparedRoute {
  index: number
  airline: number
  dep: string
  arr: string
  depLat: number
  depLon: number
  arrLat: number
  arrLon: number
  km: number
  types: string[]
  /** expected daily flights before month/weekday factors */
  baseDaily: number
  group: string
  /** departure-time profile (local hours, 24 weights) */
  profile: number[]
  depTz: string
}

/** Turn a bank window list ([[a,b], ...] or [a,b]) into 24 hourly weights. */
function bankProfile(hours: number[] | number[][]): number[] {
  const windows = (Array.isArray(hours[0]) ? hours : [hours]) as number[][]
  const w = Array(24).fill(0.05)
  for (const [a, b] of windows) for (let h = a; h < b; h++) w[h % 24] = 1
  return w
}

export function prepareRoutes(data: SimData): PreparedRoute[] {
  const { airports, routes, model } = { airports: data.airports, routes: data.routes, model: data.model }
  const prof = model.departureProfiles
  const degree = new Map<string, number>()
  for (const [, a, b] of routes.routes) {
    degree.set(a, (degree.get(a) ?? 0) + 1)
    degree.set(b, (degree.get(b) ?? 0) + 1)
  }
  const gulf = new Set(prof.banks.gulfHubs?.airports ?? [])
  const out: PreparedRoute[] = []
  routes.routes.forEach(([airline, dep, arr, types], index) => {
    const a = airports[dep]
    const b = airports[arr]
    if (!a || !b) return
    const km = distanceKm(a[4], a[5], b[4], b[5])
    if (km < SIM_CONFIG.minRouteKm) return
    const size = ((degree.get(dep) ?? 1) * (degree.get(arr) ?? 1)) ** SIM_CONFIG.sizeExponent
    const scale = data.calibration?.scale ?? SIM_CONFIG.defaultScale
    const regional = data.calibration?.countryMultipliers[a[3]] ?? 1
    const baseDaily = Math.min(SIM_CONFIG.maxDailyPerRoute, (scale * regional * size) / (1 + km / SIM_CONFIG.distanceSoftenKm))
    const gA = seasonGroup(a[3], a[4], a[5])
    const gB = seasonGroup(b[3], b[4], b[5])

    // Departure-time pattern.
    let profile = km >= prof.longHaulFromKm ? prof.longHaul : prof.shortHaul
    if (km >= prof.longHaulFromKm) {
      const banks = prof.banks
      if (gulf.has(dep) && banks.gulfHubs) profile = bankProfile(banks.gulfHubs.hours)
      else if (gA === 'europe' && gB === 'northAmerica' && banks.europeToNorthAmerica) profile = bankProfile(banks.europeToNorthAmerica.hours)
      else if (gA === 'northAmerica' && gB === 'europe' && banks.northAmericaToEurope) profile = bankProfile(banks.northAmericaToEurope.hours)
      else if (isAsia(a[4], a[5]) && gB === 'northAmerica' && banks.asiaToNorthAmerica) profile = bankProfile(banks.asiaToNorthAmerica.hours)
      else if (gA === 'northAmerica' && isAsia(b[4], b[5]) && banks.northAmericaToAsia) profile = bankProfile(banks.northAmericaToAsia.hours)
      else if (isAsia(a[4], a[5]) && gB === 'europe' && banks.asiaToEurope) profile = bankProfile(banks.asiaToEurope.hours)
    }
    out.push({
      index,
      airline,
      dep,
      arr,
      depLat: a[4],
      depLon: a[5],
      arrLat: b[4],
      arrLon: b[5],
      km,
      types: types ? types.split(' ') : [],
      baseDaily,
      group: gA,
      profile,
      depTz: a[6],
    })
  })
  return out
}

// ---------------------------------------------------------------- time zones

const offsetCache = new Map<string, number>()
/** Minutes to add to UTC to get local time in `tz` on that date (cached). */
export function tzOffsetMinutes(tz: string, dateKey: string): number {
  const key = `${tz}|${dateKey}`
  let off = offsetCache.get(key)
  if (off === undefined) {
    try {
      const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(new Date(`${dateKey}T12:00:00Z`))
        .find((p) => p.type === 'timeZoneName')?.value
      const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/)
      off = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0
    } catch {
      off = 0
    }
    offsetCache.set(key, off)
  }
  return off
}

// ---------------------------------------------------------------- daily timetable

export interface SimFlight {
  route: number // index into PreparedRoute[]
  /** epoch ms */
  dep: number
  arr: number
  type: string
  altitudeFt: number
  speedKmh: number
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** All flights departing on local date `dateKey` (YYYY-MM-DD) at their departure airport. */
export function buildDay(prepared: PreparedRoute[], data: SimData, dateKey: string): SimFlight[] {
  const [y, m, d] = dateKey.split('-').map(Number)
  const month = m - 1
  const weekday = WEEKDAYS[new Date(Date.UTC(y, month, d)).getUTCDay()]
  const wf = data.model.weekday.factors[weekday]
  const flights: SimFlight[] = []
  const dayUtc = Date.UTC(y, month, d)

  for (let i = 0; i < prepared.length; i++) {
    const r = prepared[i]
    const mf = data.model.monthly[r.group]?.factors[month] ?? 1
    const rand = rng(hash(`${SIM_CONFIG.seed}|${dateKey}|${r.index}`))
    const n = poisson(r.baseDaily * mf * wf, rand)
    if (!n) continue
    const localMidnightUtc = dayUtc - tzOffsetMinutes(r.depTz, dateKey) * 60_000
    for (let k = 0; k < n; k++) {
      const hour = pickWeighted(r.profile, rand)
      const minute = Math.floor(rand() * 60)
      const type = r.types.length ? r.types[Math.floor(rand() * r.types.length)] : defaultType(r.km, rand)
      const cls = SIM_CONFIG.classes[sizeClass(type)]
      const dep = localMidnightUtc + (hour * 60 + minute) * 60_000
      const durationMin = cls.overheadMin + (r.km / cls.speedKmh) * 60
      flights.push({
        route: i,
        dep,
        arr: dep + durationMin * 60_000,
        type,
        altitudeFt: cls.altitudeFt + (Math.floor(rand() * 5) - 2) * 1000,
        speedKmh: cls.speedKmh,
      })
    }
  }
  flights.sort((a, b) => a.dep - b.dep)
  return flights
}
