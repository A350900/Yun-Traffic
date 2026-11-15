import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AIRPORTS } from './airports.ts'

/**
 * Yesterday's flights from OpenSky's flight history: callsign, aircraft
 * address, departure and arrival airports as detected by OpenSky, and when
 * it was first/last seen. No path.
 *
 * Used for:
 *  - simulated flights: "this flew at this time yesterday", shifted +24 h
 *  - a likely destination for a live aircraft that leaves coverage
 *
 * Only the part of yesterday that matters is downloaded: flights that could
 * be in the air "now minus 24 h" (the longest flights last ~16 h), in 2-hour
 * windows (the API's maximum). As the day moves on, one new window is
 * needed every 2 hours. Windows are cached in .cache/flight-history.json, so
 * restarts never re-download. History has its own OpenSky credit allowance
 * (~30 credits per window), separate from the live snapshots.
 */

const API = 'https://opensky-network.org/api/flights/all'
const CACHE_FILE = join(import.meta.dirname, '..', '.cache', 'flight-history.json')
const DAY = 86_400
const WINDOW = 2 * 3600
const LONGEST_FLIGHT_S = 16 * 3600
const REQUEST_GAP_MS = 10_000
/** Stop before the allowance is fully used, to avoid hitting the limit. */
const MIN_CREDITS_LEFT = 40
/** Flights shorter than this are mostly circuits/local hops: not worth simulating. */
const MIN_DURATION_S = 25 * 60

export interface PastFlight {
  callsign: string
  icao24: string
  dep: string // ICAO airport code
  arr: string
  /** epoch seconds */
  firstSeen: number
  lastSeen: number
}

interface RawFlight {
  icao24: string
  callsign: string | null
  firstSeen: number
  lastSeen: number
  estDepartureAirport: string | null
  estArrivalAirport: string | null
}

type Auth = () => Promise<{ headers: Record<string, string>; authenticated: boolean }>

export class FlightHistory {
  /** window start (epoch s) -> usable flights */
  private windows: Record<string, PastFlight[]> = {}
  /** All loaded flights, sorted by firstSeen. */
  private flights: PastFlight[] = []
  private byCallsign = new Map<string, PastFlight>()
  private busy = false
  private pausedUntil = 0
  private auth: Auth
  status = { windows: 0, flights: 0, creditsLeft: null as number | null, error: null as string | null }

  constructor(auth: Auth) {
    this.auth = auth
    try {
      this.windows = JSON.parse(readFileSync(CACHE_FILE, 'utf8')).windows ?? {}
    } catch {
      /* nothing cached yet */
    }
    this.rebuild()
  }

  start() {
    void this.refresh()
    setInterval(() => void this.refresh(), 15 * 60_000)
  }

  /** Flights that were in the air exactly 24 h before `nowS` (epoch seconds). */
  airborneYesterdayAt(nowS: number): PastFlight[] {
    const t = nowS - DAY
    const out: PastFlight[] = []
    for (const f of this.flights) {
      if (f.firstSeen > t) break // sorted by firstSeen
      if (f.lastSeen >= t) out.push(f)
    }
    return out
  }

  /** Where this callsign flew yesterday, if known. */
  lastFlight(callsign: string): PastFlight | undefined {
    return this.byCallsign.get(callsign)
  }

  /** 2-hour windows needed for "now - 24 h", most important (latest) first. */
  private neededWindows(nowS: number): number[] {
    const t = nowS - DAY
    const first = Math.floor((t - LONGEST_FLIGHT_S) / WINDOW) * WINDOW
    const last = Math.floor((t + WINDOW) / WINDOW) * WINDOW // one ahead, ready for later
    const out: number[] = []
    for (let w = last; w >= first; w -= WINDOW) out.push(w)
    return out
  }

  private rebuild() {
    const all = Object.values(this.windows).flat()
    all.sort((a, b) => a.firstSeen - b.firstSeen)
    this.flights = all
    this.byCallsign = new Map(all.map((f) => [f.callsign, f]))
    this.status.windows = Object.keys(this.windows).length
    this.status.flights = all.length
  }

  private save() {
    try {
      mkdirSync(join(CACHE_FILE, '..'), { recursive: true })
      writeFileSync(CACHE_FILE, JSON.stringify({ windows: this.windows }))
    } catch (err) {
      console.warn('[history] could not save:', (err as Error).message)
    }
  }

  private async refresh() {
    if (this.busy || Date.now() < this.pausedUntil) return
    this.busy = true
    try {
      const nowS = Date.now() / 1000
      const needed = this.neededWindows(nowS)
      // Forget windows we no longer need.
      const keep = new Set(needed.map(String))
      for (const w of Object.keys(this.windows)) if (!keep.has(w)) delete this.windows[w]

      let fetched = 0
      for (const w of needed) {
        if (this.windows[w]) continue
        const done = await this.fetchWindow(w)
        if (!done) break
        fetched++
        this.rebuild()
        this.save()
        await new Promise((r) => setTimeout(r, REQUEST_GAP_MS))
      }
      this.rebuild()
      this.save()
      if (fetched) console.log(`[history] ${this.status.flights} past flights from ${this.status.windows} windows (${this.status.creditsLeft ?? '?'} history credits left)`)
      if (!this.status.error?.startsWith('paused')) this.status.error = null
    } catch (err) {
      this.status.error = (err as Error).message
      console.warn(`[history] ${this.status.error}`)
    } finally {
      this.busy = false
    }
  }

  /** Download one window. Returns false if we should stop for now. */
  private async fetchWindow(w: number): Promise<boolean> {
    const { headers } = await this.auth()
    const res = await fetch(`${API}?begin=${w}&end=${w + WINDOW}`, { headers, signal: AbortSignal.timeout(60_000) })
    const left = res.headers.get('x-rate-limit-remaining')
    if (left != null) this.status.creditsLeft = Number(left)
    if (res.status === 429) {
      await res.body?.cancel()
      const wait = Number(res.headers.get('x-rate-limit-retry-after-seconds')) || 3600
      this.pausedUntil = Date.now() + wait * 1000
      this.status.error = `paused: history allowance used up; resuming in ${Math.round(wait / 60)} min`
      console.warn(`[history] ${this.status.error}`)
      return false
    }
    if (res.status === 404) {
      await res.body?.cancel()
      this.windows[w] = [] // no flights in that window
      return true
    }
    if (!res.ok) throw new Error(`OpenSky flight history HTTP ${res.status}`)
    const out: PastFlight[] = []
    for (const f of (await res.json()) as RawFlight[]) {
      const cs = f.callsign?.trim()
      const dep = f.estDepartureAirport
      const arr = f.estArrivalAirport
      if (!cs || !dep || !arr || dep === arr) continue
      if (!AIRPORTS[dep] || !AIRPORTS[arr]) continue // need coordinates for both
      if (f.lastSeen - f.firstSeen < MIN_DURATION_S) continue
      out.push({ callsign: cs, icao24: f.icao24.toLowerCase(), dep, arr, firstSeen: f.firstSeen, lastSeen: f.lastSeen })
    }
    this.windows[w] = out
    if (this.status.creditsLeft != null && this.status.creditsLeft < MIN_CREDITS_LEFT) {
      this.pausedUntil = Date.now() + 2 * 3600_000
      this.status.error = `paused: history allowance nearly used (${this.status.creditsLeft} left); resuming later`
      return false
    }
    return true
  }
}
