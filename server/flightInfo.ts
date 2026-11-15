import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { aircraftName } from './aircraftTypes.ts'
import type { FlightInfo, AirportInfo, FlightTrace } from '../shared/wire.ts'

/**
 * Details for one aircraft, gathered when someone clicks it:
 *   route + airline   adsbdb.com (crowd-sourced callsign → route database)
 *   aircraft model    adsbdb.com
 *   photo             planespotters.net (attribution required)
 *   time zones        data/airports.json (mwgg/Airports, MIT)
 *   flown path        adsb.lol traces
 * Everything is cached so repeat clicks (and other visitors) don't refetch.
 */

const UA = { 'User-Agent': 'yun-traffic/0.1 (+https://github.com/A350900/Yun-Traffic)' }
const HOUR = 3_600_000

// ---------------------------------------------------------------- small TTL cache

class Cache<T> {
  private map = new Map<string, { value: Promise<T>; expires: number }>()
  private max: number
  constructor(max = 5000) {
    this.max = max
  }
  get(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.map.get(key)
    if (hit && hit.expires > Date.now()) return hit.value
    const value = load().catch((err) => {
      this.map.delete(key) // don't cache failures
      throw err
    })
    this.map.set(key, { value, expires: Date.now() + ttl })
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!)
    return value
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10_000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`)
  return (await res.json()) as T
}

// ---------------------------------------------------------------- airports

type AirportRow = [iata: string, name: string, city: string, country: string, lat: number, lon: number, tz: string]
const AIRPORTS: Record<string, AirportRow> = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'data', 'airports.json'), 'utf8'),
)

interface AdsbdbAirport {
  icao_code: string
  iata_code: string
  name: string
  municipality: string
  country_iso_name: string
  latitude: number
  longitude: number
}

function airport(a: AdsbdbAirport): AirportInfo {
  const row = AIRPORTS[a.icao_code]
  return {
    icao: a.icao_code,
    iata: a.iata_code || row?.[0] || null,
    name: a.name || row?.[1] || a.icao_code,
    city: a.municipality || row?.[2] || '',
    country: a.country_iso_name || row?.[3] || '',
    lat: a.latitude ?? row?.[4],
    lon: a.longitude ?? row?.[5],
    tz: row?.[6] ?? null,
  }
}

/** Nearest airport (with an IATA code) to a point, within `maxKm`. */
function nearestAirport(lat: number, lon: number, maxKm = 15): AirportInfo | null {
  let best: [string, AirportRow] | null = null
  let bestKm = maxKm
  for (const [icao, row] of Object.entries(AIRPORTS)) {
    if (Math.abs(row[4] - lat) > 0.5) continue // cheap pre-filter
    const d = distanceKm(lat, lon, row[4], row[5])
    if (d < bestKm) {
      bestKm = d
      best = [icao, row]
    }
  }
  if (!best) return null
  const [icao, r] = best
  return { icao, iata: r[0], name: r[1], city: r[2], country: r[3], lat: r[4], lon: r[5], tz: r[6] }
}

// ---------------------------------------------------------------- lookups

interface AdsbdbAirline {
  name: string
  icao: string
  iata: string | null
}

const routeCache = new Cache<{ airline: AdsbdbAirline | null; origin: AirportInfo; destination: AirportInfo } | null>()
const airlineCache = new Cache<AdsbdbAirline | null>()
const aircraftCache = new Cache<{ type: string; icao_type: string; manufacturer: string; registration: string; registered_owner: string } | null>()
const photoCache = new Cache<FlightInfo['photo']>()

function route(callsign: string) {
  return routeCache.get(callsign, 6 * HOUR, async () => {
    const body = await getJson<{ response: { flightroute: { airline: AdsbdbAirline | null; origin: AdsbdbAirport; destination: AdsbdbAirport } } }>(
      `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`,
    )
    const r = body?.response?.flightroute
    return r ? { airline: r.airline, origin: airport(r.origin), destination: airport(r.destination) } : null
  })
}

function airline(icao: string) {
  return airlineCache.get(icao, 24 * HOUR, async () => {
    const body = await getJson<{ response: AdsbdbAirline[] }>(`https://api.adsbdb.com/v0/airline/${encodeURIComponent(icao)}`)
    return body?.response?.[0] ?? null
  })
}

function aircraft(hex: string) {
  return aircraftCache.get(hex, 24 * HOUR, async () => {
    const body = await getJson<{ response: { aircraft: NonNullable<Awaited<ReturnType<typeof aircraftCache.get>>> } }>(
      `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(hex)}`,
    )
    return body?.response?.aircraft ?? null
  })
}

function photo(hex: string, reg: string | null) {
  return photoCache.get(`${hex}|${reg ?? ''}`, 24 * HOUR, async () => {
    type P = { photos: { thumbnail_large: { src: string }; link: string; photographer: string }[] }
    let body = await getJson<P>(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`)
    if (!body?.photos?.length && reg) body = await getJson<P>(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`)
    const p = body?.photos?.[0]
    return p ? { src: p.thumbnail_large.src, link: p.link, photographer: p.photographer } : null
  })
}

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

const settle = <T,>(p: Promise<T>) => p.catch(() => null)

/**
 * Everything for the details panel. `pos` is the aircraft's current position,
 * used to sanity-check the route: the callsign database is crowd-sourced and
 * occasionally out of date (airlines reuse flight numbers).
 */
export async function flightInfo(hex: string, callsign: string | null, reg: string | null, pos: [number, number] | null): Promise<FlightInfo> {
  const airlinePrefix = callsign?.match(/^([A-Z]{3})\d/)?.[1] ?? null
  const [r0, al, ac, tr] = await Promise.all([
    callsign ? settle(route(callsign)) : null,
    airlinePrefix ? settle(airline(airlinePrefix)) : null,
    settle(aircraft(hex)),
    settle(flightTrace(hex)),
  ])
  // The callsign database is crowd-sourced and can be stale. If we saw where
  // this aircraft actually took off and it's a different airport, trust that.
  let r = r0
  let originCorrected = false
  const start = tr?.points[0]
  if (r && start && start[3] === -1 && distanceKm(start[1], start[2], r.origin.lat, r.origin.lon) > 25) {
    const actual = nearestAirport(start[1], start[2])
    if (actual && actual.icao !== r.origin.icao) {
      r = { ...r, origin: actual }
      originCorrected = true
    }
  }
  const registration = reg ?? ac?.registration ?? null
  const ph = await settle(photo(hex, registration))

  let routeOk = false
  if (r && pos) {
    const total = distanceKm(r.origin.lat, r.origin.lon, r.destination.lat, r.destination.lon)
    const via = distanceKm(r.origin.lat, r.origin.lon, pos[0], pos[1]) + distanceKm(pos[0], pos[1], r.destination.lat, r.destination.lon)
    routeOk = via <= total * 1.25 + 300
  }

  const airlineInfo = r?.airline ?? al
  return {
    hex,
    callsign,
    airline: airlineInfo ? { name: airlineInfo.name, icao: airlineInfo.icao, iata: airlineInfo.iata } : null,
    aircraft: {
      typeCode: ac?.icao_type ?? null,
      name: aircraftName(ac?.icao_type ?? null, ac?.type, ac?.manufacturer),
      registration,
      owner: ac?.registered_owner ?? null,
    },
    route: r ? { origin: r.origin, destination: r.destination, plausible: routeOk, originCorrected } : null,
    photo: ph,
  }
}

// ---------------------------------------------------------------- flown path

type TracePoint = [dt: number, lat: number, lon: number, alt: number | 'ground' | null, ...rest: unknown[]]
interface RawTrace {
  timestamp: number
  trace: TracePoint[]
  desc?: string
}

const fullTraceCache = new Cache<RawTrace | null>(500)
const recentTraceCache = new Cache<RawTrace | null>(500)

async function getTrace(kind: 'full' | 'recent', hex: string): Promise<RawTrace | null> {
  const res = await fetch(`https://api.adsb.lol/1/trace/${kind}/${encodeURIComponent(hex)}`, { headers: UA, signal: AbortSignal.timeout(15_000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`adsb.lol trace HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // Usually served gzip-encoded; fetch may or may not have unpacked it already.
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
  return JSON.parse(text) as RawTrace
}

/**
 * The path flown on the current flight: positions since the last time the
 * aircraft was on the ground, as [epoch ms, lat, lon, altitude ft (-1 = ground)].
 */
export async function flightTrace(hex: string): Promise<FlightTrace> {
  const [full, recent] = await Promise.all([
    settle(fullTraceCache.get(hex, 120_000, () => getTrace('full', hex))),
    settle(recentTraceCache.get(hex, 20_000, () => getTrace('recent', hex))),
  ])
  const points: [number, number, number, number][] = []
  for (const t of [full, recent]) {
    if (!t) continue
    for (const p of t.trace) {
      const alt = p[3] === 'ground' ? -1 : typeof p[3] === 'number' ? p[3] : null
      if (alt == null) continue
      points.push([Math.round((t.timestamp + p[0]) * 1000), p[1], p[2], alt])
    }
  }
  points.sort((a, b) => a[0] - b[0])

  // De-duplicate (full and recent overlap) and keep only the current leg.
  const out: [number, number, number, number][] = []
  let takeoff: number | null = null
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && p[0] - last[0] < 1000) continue
    // A long gap means a new flight even without a ground report.
    if (last && p[0] - last[0] > 45 * 60_000) out.length = 0
    if (p[3] === -1) {
      out.length = 0 // on the ground: the flight starts after this
      takeoff = null
      out.push(p)
      continue
    }
    if (takeoff == null && (out.length === 0 || out[out.length - 1][3] === -1)) takeoff = out.length ? p[0] : null
    out.push(p)
  }
  // Drop the taxiing points except the last one (the takeoff spot).
  while (out.length > 1 && out[0][3] === -1 && out[1][3] === -1) out.shift()

  // Keep the line light: at most ~800 points.
  const step = Math.ceil(out.length / 800)
  const thinned = step > 1 ? out.filter((_, i) => i % step === 0 || i === out.length - 1) : out
  return { hex, takeoff, points: thinned }
}
