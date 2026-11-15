import type { AircraftTuple } from '../shared/wire.ts'

const BASE = process.env.ADSB_API_BASE ?? 'https://api.adsb.lol'

export class RateLimitedError extends Error {
  retryAfterSec: number
  constructor(retryAfterSec: number) {
    super(`adsb.lol rate limit, retry after ${retryAfterSec}s`)
    this.retryAfterSec = retryAfterSec
  }
}

interface RawAircraft {
  hex: string
  flight?: string
  r?: string
  t?: string
  lat?: number
  lon?: number
  alt_baro?: number | 'ground'
  gs?: number
  track?: number
  true_heading?: number
  baro_rate?: number
  geom_rate?: number
  squawk?: string
  category?: string
  seen_pos?: number
}

export interface RawResponse {
  /** adsb.lol / readsb name */
  ac?: RawAircraft[]
  /** adsb.fi name for the same list */
  aircraft?: RawAircraft[]
  now: number
}

/** Some transponders send blank or all-zero callsigns. */
function cleanCallsign(raw?: string) {
  const cs = raw?.trim()
  return cs && !/^0+$/.test(cs) ? cs : null
}

export function normalize(raw: RawResponse): AircraftTuple[] {
  const out: AircraftTuple[] = []
  for (const a of raw.ac ?? raw.aircraft ?? []) {
    if (a.lat == null || a.lon == null) continue
    // TIS-B / anonymised addresses start with "~"; keep them, they're real traffic.
    out.push([
      a.hex,
      Math.round(a.lat * 1e5) / 1e5,
      Math.round(a.lon * 1e5) / 1e5,
      a.track ?? a.true_heading ?? null,
      a.gs != null ? Math.round(a.gs) : null,
      a.alt_baro === 'ground' ? -1 : (a.alt_baro ?? null),
      cleanCallsign(a.flight),
      a.t ?? null,
      a.r ?? null,
      Math.round(raw.now - (a.seen_pos ?? 0) * 1000),
      a.squawk ?? null,
      a.category ?? null,
      a.baro_rate ?? a.geom_rate ?? null,
    ])
  }
  return out
}

async function get(path: string): Promise<AircraftTuple[]> {
  const res = await fetch(BASE + path, {
    headers: { 'User-Agent': 'yun-traffic/0.1 (+https://github.com/A350900/Yun-Traffic)' },
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 429) {
    await res.body?.cancel()
    throw new RateLimitedError(Number(res.headers.get('retry-after')) || 30)
  }
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`adsb.lol ${path} -> HTTP ${res.status}`)
  }
  return normalize((await res.json()) as RawResponse)
}

/** Every aircraft of an ICAO type designator, worldwide. */
export const byType = (type: string) => get(`/v2/type/${encodeURIComponent(type)}`)

/** Every aircraft within `radiusNm` (max 250) of a point. */
export const byPoint = (lat: number, lon: number, radiusNm: number) =>
  get(`/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${Math.min(250, Math.round(radiusNm))}`)

/** Military-registered aircraft, worldwide. */
export const military = () => get('/v2/mil')
