import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { aircraftName } from './aircraftTypes.ts'
import type { FlightInfo, AirportInfo, FlightTrace, FlightPhoto } from '../shared/wire.ts'

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

/** Give up on any one source after this long, so it can't hold up the panel. */
const SOURCE_TIMEOUT_MS = 6000

async function getJson<T>(url: string): Promise<T | null> {
  const started = Date.now()
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) }).finally(() => {
    const ms = Date.now() - started
    if (ms > 2500) console.warn(`[details] slow response: ${new URL(url).host} took ${(ms / 1000).toFixed(1)}s`)
  })
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
const photoCache = new Cache<FlightPhoto>()

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
  return photoCache.get(reg ? `reg:${reg}` : `hex:${hex}`, 24 * HOUR, async () => {
    type P = { photos: { thumbnail_large: { src: string }; link: string; photographer: string }[] }
    const body = reg
      ? await getJson<P>(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`)
      : await getJson<P>(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`)
    const p = body?.photos?.[0]
    return p ? { src: p.thumbnail_large.src, link: p.link, photographer: p.photographer } : null
  })
}

/** Initial great-circle bearing from point 1 to point 2, degrees true. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r)
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r)
  return (Math.atan2(y, x) / r + 360) % 360
}
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

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
export async function flightInfo(
  hex: string,
  callsign: string | null,
  reg: string | null,
  pos: [number, number] | null,
  /** Type code from the live data, used when the aircraft database has no record */
  liveType: string | null = null,
  /** live track (degrees) and altitude (ft, -1 = ground), for the direction check */
  track: number | null = null,
  altitude: number | null = null,
): Promise<FlightInfo> {
  const airlinePrefix = callsign?.match(/^([A-Z]{3})\d/)?.[1] ?? null
  // Everything at once. The flown path is only used to double-check the
  // departure airport, so don't wait more than a moment for it; if it arrives
  // later the panel asks again and gets the corrected answer from the cache.
  // (The photo has its own endpoint so a slow photo service never holds up the route.)
  const [r0, al, ac, tr] = await Promise.all([
    callsign ? settle(route(callsign)) : null,
    airlinePrefix ? settle(airline(airlinePrefix)) : null,
    settle(aircraft(hex)),
    Promise.race([settle(flightTrace(hex)), new Promise<null>((r) => setTimeout(() => r(null), 600))]),
  ])
  const registration = reg ?? ac?.registration ?? tr?.aircraft?.registration ?? null
  const typeCode = ac?.icao_type ?? liveType ?? tr?.aircraft?.type ?? null

  // The callsign database is crowd-sourced and can be stale. If we saw where
  // this aircraft actually took off and it's a different airport, trust that.
  let r = r0
  let originCorrected = false
  const start = tr?.points[0]
  // On the ground, or still low (coverage often starts just after takeoff).
  const startsLow = start && (start[3] === -1 || start[3] < 4000)
  if (r && start && startsLow && distanceKm(start[1], start[2], r.origin.lat, r.origin.lon) > 25) {
    const actual = nearestAirport(start[1], start[2], start[3] === -1 ? 15 : 35)
    if (actual && actual.icao !== r.origin.icao) {
      r = { ...r, origin: actual }
      originCorrected = true
    }
  }

  // Flight numbers get reused, and the database often has a flight the other way
  // round (the return leg). Both pass the "is it on the path" test, so also check
  // which way it's heading: towards the listed origin = reversed; away from both = wrong.
  let reversed = false
  let headingOk = true
  if (r && pos && track != null && altitude != null && altitude > 10000 && !originCorrected) {
    const dDest = distanceKm(pos[0], pos[1], r.destination.lat, r.destination.lon)
    const dOrig = distanceKm(pos[0], pos[1], r.origin.lat, r.origin.lon)
    // Away from airports only (departure/arrival turns, holding).
    if (dDest > 250 && dOrig > 250) {
      const offDest = angleDiff(track, bearing(pos[0], pos[1], r.destination.lat, r.destination.lon))
      const offOrig = angleDiff(track, bearing(pos[0], pos[1], r.origin.lat, r.origin.lon))
      if (offDest > 100) {
        if (offOrig < 50) {
          r = { ...r, origin: r.destination, destination: r.origin }
          reversed = true
        } else headingOk = false
      }
    }
  }

  let routeOk = false
  if (r && pos) {
    const total = distanceKm(r.origin.lat, r.origin.lon, r.destination.lat, r.destination.lon)
    const via = distanceKm(r.origin.lat, r.origin.lon, pos[0], pos[1]) + distanceKm(pos[0], pos[1], r.destination.lat, r.destination.lon)
    routeOk = headingOk && via <= total * 1.2 + 200
  }

  const airlineInfo = r?.airline ?? al
  return {
    hex,
    callsign,
    airline: airlineInfo ? { name: airlineInfo.name, icao: airlineInfo.icao, iata: airlineInfo.iata } : null,
    aircraft: {
      typeCode,
      name: aircraftName(typeCode, ac?.type, ac?.manufacturer, tr?.aircraft?.desc),
      registration,
      owner: ac?.registered_owner ?? null,
    },
    route: r ? { origin: r.origin, destination: r.destination, plausible: routeOk, originCorrected, verified: Boolean(tr && !tr.partial), reversed } : null,
  }
}

/** Photo for the details panel: by ICAO hex, else by registration (from the live data or the aircraft database). */
export async function flightPhoto(hex: string, reg: string | null): Promise<FlightPhoto> {
  const byHex = await settle(photo(hex, null))
  if (byHex) return byHex
  const registration = reg ?? (await settle(aircraft(hex)))?.registration ?? null
  return registration ? await settle(photo(hex, registration)) : null
}

// ---------------------------------------------------------------- flown path

type TracePoint = [dt: number, lat: number, lon: number, alt: number | 'ground' | null, ...rest: unknown[]]
interface RawTrace {
  timestamp: number
  trace: TracePoint[]
  /** type code, registration and description from the aircraft database */
  t?: string
  r?: string
  desc?: string
}

const fullTraceCache = new Cache<RawTrace | null>(500)
const recentTraceCache = new Cache<RawTrace | null>(500)

/** Called before each trace request (lets the server pause its own background polling of the same API). */
let beforeTraceRequest = () => {}
export function onTraceRequest(fn: () => void) {
  beforeTraceRequest = fn
}

async function getTrace(kind: 'full' | 'recent', hex: string): Promise<RawTrace | null> {
  // adsb.lol rate-limits per client; a quick retry usually gets through.
  for (const delay of [0, 700, 1600]) {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    beforeTraceRequest()
    const t = await getTraceOnce(kind, hex)
    if (t !== 'rate-limited') return t
  }
  throw new Error('adsb.lol trace: rate limited')
}

async function getTraceOnce(kind: 'full' | 'recent', hex: string): Promise<RawTrace | null | 'rate-limited'> {
  const res = await fetch(`https://api.adsb.lol/1/trace/${kind}/${encodeURIComponent(hex)}`, { headers: UA, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) })
  if (res.status === 404) return null
  if (res.status === 429) return 'rate-limited'
  if (!res.ok) throw new Error(`adsb.lol trace HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // Usually served gzip-encoded; fetch may or may not have unpacked it already.
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8')
  return JSON.parse(text) as RawTrace
}

/**
 * Does a gap in the data separate two different flights? Receiver coverage
 * often drops out for a while mid-flight (mountains, deserts, oceans), so a
 * gap alone isn't enough: it must look like the aircraft landed in between.
 */
function isNewFlight(a: [number, number, number, number], b: [number, number, number, number]) {
  const gapMin = (b[0] - a[0]) / 60_000
  if (gapMin < 30) return false
  if (gapMin > 240) return true
  const low = (alt: number) => alt >= 0 && alt < 8000
  if (low(a[3]) || low(b[3])) return true
  // Barely moved during the gap? Then it sat somewhere.
  const kt = distanceKm(a[1], a[2], b[1], b[2]) / 1.852 / (gapMin / 60)
  return kt < 150
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

  // De-duplicate (full and recent overlap) and keep only the current flight.
  const out: [number, number, number, number][] = []
  let takeoff: number | null = null
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && p[0] - last[0] < 1000) continue
    if (last && isNewFlight(last, p)) {
      out.length = 0
      takeoff = null
    }
    if (p[3] === -1) {
      out.length = 0 // on the ground: the flight starts after this
      takeoff = null
      out.push(p)
      continue
    }
    if (takeoff == null && out.length && out[out.length - 1][3] === -1) takeoff = p[0]
    out.push(p)
  }
  // Drop the taxiing points except the last one (the takeoff spot).
  while (out.length > 1 && out[0][3] === -1 && out[1][3] === -1) out.shift()

  // Keep the line light: at most ~800 points.
  const step = Math.ceil(out.length / 800)
  const thinned = step > 1 ? out.filter((_, i) => i % step === 0 || i === out.length - 1) : out
  // Without the full history we only have the last few minutes; say so, so
  // the client retries soon instead of showing a half-drawn path for 30 s.
  const meta = full ?? recent
  return {
    hex,
    takeoff,
    points: thinned,
    partial: !full,
    aircraft: meta ? { type: meta.t ?? null, registration: meta.r ?? null, desc: meta.desc ?? null } : null,
  }
}
