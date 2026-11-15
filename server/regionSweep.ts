import type { AircraftTuple } from '../shared/wire.ts'
import { normalize, RateLimitedError, type RawResponse } from './adsbLol.ts'
import type { AircraftStore } from './store.ts'

/**
 * Sweeps the world with "everything within 250 nm of this point" queries.
 *
 * Community networks like adsb.fi see aircraft OpenSky doesn't, but only
 * answer area queries (max 250 nm) at about 1 request/second. So we tile the
 * world into ~900 overlapping circles and keep visiting them, busiest first:
 *
 *   score = sqrt(expected aircraft + 1) × seconds since last visit
 *
 * "Expected aircraft" comes from the cell's last result, or, before we've
 * visited it, from how many aircraft other sources (OpenSky) already put
 * there. Busy cells come round every few minutes; empty ocean about every
 * half hour.
 */

const RADIUS_NM = 250
const MIN_LAT = -56
const MAX_LAT = 72
// Rows evenly spaced, at most 6.5° apart; with LON_SPAN below every point
// between MIN_LAT and MAX_LAT is within 250 nm of a cell centre.
const ROWS = Math.ceil((MAX_LAT - MIN_LAT) / 6.5) + 1
const LAT_STEP = (MAX_LAT - MIN_LAT) / (ROWS - 1)
const LON_SPAN = 5.2 // degrees of longitude × cos(lat) between cell centres

interface Cell {
  lat: number
  lon: number
  row: number
  lastPolled: number
  lastCount: number
  /** Aircraft other sources currently place in this cell */
  estimate: number
}

function buildGrid(): { cells: Cell[]; rows: Cell[][] } {
  const cells: Cell[] = []
  const rows: Cell[][] = []
  let row = 0
  for (; row < ROWS; row++) {
    const lat = MIN_LAT + row * LAT_STEP
    const step = LON_SPAN / Math.max(Math.cos((lat * Math.PI) / 180), 0.15)
    const n = Math.ceil(360 / step)
    const r: Cell[] = []
    for (let i = 0; i < n; i++) {
      const cell = { lat, lon: -180 + (i + 0.5) * (360 / n), row, lastPolled: 0, lastCount: 0, estimate: 0 }
      r.push(cell)
      cells.push(cell)
    }
    rows.push(r)
  }
  return { cells, rows }
}

export interface RegionSource {
  name: string
  /** Builds the request URL for a point query */
  url: (lat: number, lon: number, radiusNm: number) => string
  /** Milliseconds between requests (the provider's published limit, plus margin) */
  intervalMs: number
}

export class RegionSweep {
  private grid = buildGrid()
  private store: AircraftStore
  private source: RegionSource
  private interval: number
  private pausedUntil = 0
  status = { lastFetch: null as number | null, requests: 0, cells: 0, rateLimited: false, error: null as string | null }

  constructor(store: AircraftStore, source: RegionSource) {
    this.store = store
    this.source = source
    this.interval = source.intervalMs
    this.status.cells = this.grid.cells.length
  }

  start() {
    console.log(`[${this.source.name}] sweeping ${this.grid.cells.length} regions, one every ${this.interval} ms`)
    this.updateEstimates()
    setInterval(() => this.updateEstimates(), 60_000)
    const loop = async () => {
      const started = Date.now()
      if (started >= this.pausedUntil) await this.tick()
      const wait = Math.max(this.interval - (Date.now() - started), this.pausedUntil - Date.now(), 50)
      setTimeout(loop, wait)
    }
    void loop()
  }

  /** Nearest cell for a position (cells are laid out in rows, so this is cheap). */
  private cellFor(lat: number, lon: number): Cell | null {
    const row = Math.round((lat - MIN_LAT) / LAT_STEP)
    const r = this.grid.rows[row]
    if (!r) return null
    const idx = Math.floor(((lon + 180) / 360) * r.length)
    return r[Math.min(Math.max(idx, 0), r.length - 1)]
  }

  /** Use what other sources already know to find the busy areas. */
  private updateEstimates() {
    for (const c of this.grid.cells) c.estimate = 0
    this.store.forEach((ac: AircraftTuple) => {
      const c = this.cellFor(ac[1], ac[2])
      if (c) c.estimate++
    })
  }

  private pick(now: number): Cell {
    let best = this.grid.cells[0]
    let bestScore = -1
    for (const c of this.grid.cells) {
      // Never-visited cells count as last seen 10 minutes ago, so busy ones go first.
      const age = c.lastPolled ? now - c.lastPolled : 600_000
      const score = Math.sqrt(Math.max(c.lastCount, c.estimate) + 1) * age
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    }
    return best
  }

  private async tick() {
    const now = Date.now()
    const cell = this.pick(now)
    cell.lastPolled = now
    try {
      const res = await fetch(this.source.url(cell.lat, cell.lon, RADIUS_NM), {
        headers: { 'User-Agent': 'yun-traffic/0.1 (+https://github.com/A350900/Yun-Traffic)' },
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status === 429) {
        await res.body?.cancel()
        throw new RateLimitedError(Number(res.headers.get('retry-after')) || 30)
      }
      if (!res.ok) {
        await res.body?.cancel()
        throw new Error(`HTTP ${res.status}`)
      }
      const aircraft = normalize((await res.json()) as RawResponse)
      for (const ac of aircraft) this.store.upsert(ac, 'adsb.fi')
      cell.lastCount = aircraft.length
      this.status.lastFetch = Date.now()
      this.status.requests++
      this.status.rateLimited = false
      this.status.error = null
      this.interval = Math.max(this.source.intervalMs, this.interval * 0.98)
    } catch (err) {
      cell.lastPolled = now - 300_000 // retry this cell fairly soon
      if (err instanceof RateLimitedError) {
        this.status.rateLimited = true
        this.pausedUntil = Date.now() + err.retryAfterSec * 1000
        this.interval = Math.min(this.interval * 1.25, 10_000)
        console.warn(`[${this.source.name}] rate limited; pausing ${err.retryAfterSec}s, interval ${Math.round(this.interval)} ms`)
      } else {
        this.status.error = (err as Error).message
        console.warn(`[${this.source.name}] ${this.status.error}`)
      }
    }
  }
}

/** adsb.fi open data: 1 request/second, personal non-commercial use, attribution required. */
export const ADSB_FI: RegionSource = {
  name: 'adsb.fi',
  url: (lat, lon, r) => `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${r}`,
  intervalMs: Number(process.env.ADSBFI_INTERVAL_MS ?? 1100),
}
