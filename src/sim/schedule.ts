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
const isSouthAmerica = (lat: number, lon: number) => lon > -82 && lon < -34 && lat < 13

/** Key for a pair of countries, alphabetical ("CN-US"). */
export const countryPair = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Long ocean corridor a route belongs to (keys of traffic-model.json "corridorDailyFlights"), if any. */
export function corridorOf(a: { country: string; lat: number; lon: number }, b: { country: string; lat: number; lon: number }): string | null {
  const gA = seasonGroup(a.country, a.lat, a.lon)
  const gB = seasonGroup(b.country, b.lat, b.lon)
  if ((gA === 'europe' && gB === 'northAmerica') || (gA === 'northAmerica' && gB === 'europe')) return 'europeNorthAmerica'
  const hawaii = (p: { country: string; lat: number; lon: number }) => p.country === 'US' && p.lon < -150 && p.lat < 25
  const mainland = (p: { lat: number; lon: number }) => p.lon > -130 && p.lon < -60 && p.lat > 15
  if ((hawaii(a) && mainland(b)) || (hawaii(b) && mainland(a))) return 'hawaiiMainland'
  // the Americas <-> Asia/Oceania (lon > 100: east Asia, Southeast Asia, Australia, NZ)
  if ((a.lon < -30 && b.lon > 100) || (b.lon < -30 && a.lon > 100)) return 'transpacific'
  return null
}
const WIDE = /^(A3[0-5]|A38|B74|B76|B77|B78|MD11|DC10|IL96|IL86|L101|A400|C17)/
const TURBOPROP = /^(AT[4-7]|DH8|DHC|SF34|JS[0-9]|B190|F50|E120|C208|A748|SB20|D328|L410|BE[0-9]|PC12|SW4|SH36|AN2|AN24|AN26|Y12|MA60|DO28)/
const REGIONAL = /^(CRJ|E13|E14|E17|E75|E19|E29|ERJ|F70|F100|B46|RJ|AJ27|SU95)/

export function sizeClass(type: string): SizeClass {
  if (WIDE.test(type)) return 'widebody'
  if (TURBOPROP.test(type)) return 'turboprop'
  if (REGIONAL.test(type)) return 'regional'
  return 'narrowbody'
}

/** Names for the default types used when a route lists no aircraft. */
export const DEFAULT_TYPE_NAMES: Record<string, string> = {
  AT76: 'ATR 72-600', E190: 'Embraer E190', CRJ9: 'Bombardier CRJ900', A320: 'Airbus A320', B738: 'Boeing 737-800',
  B77W: 'Boeing 777-300ER', A359: 'Airbus A350-900', B789: 'Boeing 787-9', A333: 'Airbus A330-300',
}

function defaultType(km: number, rand: () => number): string {
  if (km < 350) return 'AT76'
  if (km < 900) return rand() < 0.5 ? 'E190' : 'CRJ9'
  if (km < 4500) return rand() < 0.5 ? 'A320' : 'B738'
  return ['B77W', 'A359', 'B789', 'A333'][Math.floor(rand() * 4)]
}

// ---------------------------------------------------------------- prepared routes

/** Freighters depart around the clock (hub waves differ by airline; on average it's flat). */
const CARGO_PROFILE: number[] = Array(24).fill(1)

export interface PreparedRoute {
  /** stable key for this route direction (seeds its daily random draw) */
  key: string
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

/** Turn a bank ([[from, to, weight?], ...] or [from, to], local hours) into 24 hourly weights. */
function bankProfile(bank: { hours: number[] | number[][]; floor?: number }): number[] {
  const windows = (Array.isArray(bank.hours[0]) ? bank.hours : [bank.hours]) as number[][]
  const w = Array(24).fill(bank.floor ?? 0.05)
  for (const [a, b, weight = 1] of windows) for (let h = a; h < b; h++) w[h % 24] = Math.max(w[h % 24], weight)
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
  const scale = data.calibration?.scale ?? SIM_CONFIG.defaultScale
  const soften = data.calibration?.distanceSoftenKm ?? SIM_CONFIG.distanceSoftenKm
  const mult = (country: string) => data.calibration?.countryMultipliers[country] ?? 1

  // Airlines fly their routes both ways, but the 2014 data sometimes lists only one
  // direction. Merge each airline's A->B and B->A into one pair (types combined) and
  // give both directions the same frequency.
  const pairs = new Map<string, { index: number; airline: number; dep: string; arr: string; types: Set<string> }>()
  routes.routes.forEach(([airline, dep, arr, types], index) => {
    const k = dep < arr ? `${airline}|${dep}|${arr}` : `${airline}|${arr}|${dep}`
    let p = pairs.get(k)
    if (!p) pairs.set(k, (p = { index, airline, dep, arr, types: new Set() }))
    if (types) for (const t of types.split(' ')) p.types.add(t)
  })

  const out: PreparedRoute[] = []
  const pushBothWays = (key: string | number, airline: number, dep0: string, arr0: string, km: number, types: string[], baseDaily: number, fixedProfile: number[] | null) => {
    for (const [dep, arr, A, B, dir] of [
      [dep0, arr0, airports[dep0], airports[arr0], ''],
      [arr0, dep0, airports[arr0], airports[dep0], 'r'],
    ] as const) {
      const gA = seasonGroup(A[3], A[4], A[5])
      const gB = seasonGroup(B[3], B[4], B[5])
      // Departure-time pattern.
      let profile = fixedProfile ?? (km >= prof.longHaulFromKm ? prof.longHaul : prof.shortHaul)
      if (!fixedProfile && km >= prof.longHaulFromKm) {
        const banks = prof.banks
        if (gulf.has(dep) && banks.gulfHubs) profile = bankProfile(banks.gulfHubs)
        else if (gA === 'europe' && gB === 'northAmerica' && banks.europeToNorthAmerica) profile = bankProfile(banks.europeToNorthAmerica)
        else if (gA === 'northAmerica' && gB === 'europe' && banks.northAmericaToEurope) profile = bankProfile(banks.northAmericaToEurope)
        else if (isAsia(A[4], A[5]) && gB === 'northAmerica' && banks.asiaToNorthAmerica) profile = bankProfile(banks.asiaToNorthAmerica)
        else if (gA === 'northAmerica' && isAsia(B[4], B[5]) && banks.northAmericaToAsia) profile = bankProfile(banks.northAmericaToAsia)
        else if (isAsia(A[4], A[5]) && gB === 'europe' && banks.asiaToEurope) profile = bankProfile(banks.asiaToEurope)
        else if (isSouthAmerica(A[4], A[5]) && gB === 'northAmerica' && banks.southAmericaToNorthAmerica) profile = bankProfile(banks.southAmericaToNorthAmerica)
        else if (gA === 'northAmerica' && isSouthAmerica(B[4], B[5]) && banks.northAmericaToSouthAmerica) profile = bankProfile(banks.northAmericaToSouthAmerica)
      }
      out.push({
        key: `${key}${dir}`,
        airline,
        dep,
        arr,
        depLat: A[4],
        depLon: A[5],
        arrLat: B[4],
        arrLon: B[5],
        km,
        types,
        baseDaily,
        group: gA,
        profile,
        depTz: A[6],
      })
    }
  }
  for (const pair of pairs.values()) {
    const a = airports[pair.dep]
    const b = airports[pair.arr]
    if (!a || !b) continue
    const km = distanceKm(a[4], a[5], b[4], b[5])
    if (km < SIM_CONFIG.minRouteKm) continue
    const size = ((degree.get(pair.dep) ?? 1) * (degree.get(pair.arr) ?? 1)) ** SIM_CONFIG.sizeExponent
    // Regional calibration: both ends count equally (geometric mean), so a route has the
    // same frequency in both directions.
    const regional = Math.sqrt(mult(a[3]) * mult(b[3]))
    const corridor = corridorOf({ country: a[3], lat: a[4], lon: a[5] }, { country: b[3], lat: b[4], lon: b[5] })
    const corridorMult = corridor ? (data.calibration?.corridorMultipliers?.[corridor] ?? 1) : 1
    const pairMult = data.calibration?.pairMultipliers?.[countryPair(a[3], b[3])] ?? 1
    const cap = km >= prof.longHaulFromKm ? SIM_CONFIG.maxDailyLongHaul : SIM_CONFIG.maxDailyPerRoute
    const baseDaily = Math.min(cap, (scale * regional * corridorMult * pairMult * size) / (1 + km / soften))
    pushBothWays(pair.index, pair.airline, pair.dep, pair.arr, km, [...pair.types], baseDaily, null)
  }

  // Freighters: fixed frequencies (not calibrated), departing at any hour.
  const cargo = data.cargo
  if (cargo) {
    const airlineBase = routes.airlines.length
    const airlineIndex = new Map(cargo.airlines.map((al, i) => [al[0], airlineBase + i]))
    cargo.routes.forEach(([al, dep, arr, types, daily], i) => {
      const a = airports[dep]
      const b = airports[arr]
      if (!a || !b) return
      pushBothWays(`c${i}`, airlineIndex.get(al) ?? 0, dep, arr, distanceKm(a[4], a[5], b[4], b[5]), types.split(' '), daily, CARGO_PROFILE)
    })
  }
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
    const rand = rng(hash(`${SIM_CONFIG.seed}|${dateKey}|${r.key}`))
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
