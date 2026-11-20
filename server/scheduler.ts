import { byPoint, byType, military, RateLimitedError } from './adsbLol.ts'
import type { AircraftStore } from './store.ts'
import { SEED_TYPES } from './types.ts'

/**
 * adsb.lol has no "all aircraft" endpoint and rate-limits clients fairly
 * hard (bursts of ~15 requests, then a ~30s cooldown). So instead of one big
 * query we run a single paced request loop that combines two things:
 *
 *  1. A worldwide sweep by aircraft type (`/v2/type/A320` etc.). A few dozen
 *     common types cover most airborne traffic. Types with more aircraft get
 *     polled more often, and new types seen elsewhere are added to the rotation.
 *  2. Focus queries (`/v2/point/...`) for regions people are zoomed into, so
 *     the area on screen gets *everything* (GA, helicopters, rare types) and
 *     fresher positions.
 *
 * Pacing adapts: a 429 slows us down, successes slowly speed us back up.
 */

// Slower than adsb.lol's limit on purpose: OpenSky and airplanes.live provide
// most coverage, and this leaves room for flight-path lookups on click.
const MIN_INTERVAL = Number(process.env.POLL_INTERVAL_MS ?? 6000)
const MAX_INTERVAL = 20_000
const MAX_TYPES = 200
const FOCUS_COOLDOWN_MS = 20_000
const MAX_PENDING_FOCUS = 4

interface TypeJob {
  kind: 'type'
  type: string
  lastPolled: number
  lastCount: number
}
interface MilJob {
  kind: 'mil'
  lastPolled: number
  lastCount: number
}
interface FocusJob {
  kind: 'focus'
  key: string
  lat: number
  lon: number
  radiusNm: number
}

export class Scheduler {
  private types = new Map<string, TypeJob>()
  private mil: MilJob = { kind: 'mil', lastPolled: 0, lastCount: 20 }
  private focusQueue: FocusJob[] = []
  private focusDone = new Map<string, number>()
  private interval = MIN_INTERVAL
  private pausedUntil = 0
  private preferFocus = true
  private timer: NodeJS.Timeout | null = null

  lastFetch: number | null = null
  rateLimited = false

  private store: AircraftStore

  constructor(store: AircraftStore) {
    this.store = store
    for (const t of SEED_TYPES) this.addType(t, 10)
  }

  start() {
    const loop = async () => {
      const started = Date.now()
      if (started >= this.pausedUntil) await this.tick()
      const wait = Math.max(this.interval - (Date.now() - started), this.pausedUntil - Date.now(), 250)
      this.timer = setTimeout(loop, wait)
    }
    loop()
  }

  /** Hold off background requests for a moment (someone is looking at one aircraft: its details go first). */
  yieldFor(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms)
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
  }

  /** Approximate seconds for a full pass over every known type. */
  get sweepSeconds() {
    return Math.round(((this.types.size + 1) * this.interval) / 1000)
  }

  /** Ask for a region to be fetched soon (called when a client zooms in). */
  requestFocus(lat: number, lon: number, radiusNm: number) {
    const key = `${Math.round(lat * 2) / 2},${Math.round(lon * 2) / 2},${Math.round(radiusNm / 50)}`
    if (Date.now() - (this.focusDone.get(key) ?? 0) < FOCUS_COOLDOWN_MS) return
    if (this.focusQueue.some((f) => f.key === key)) return
    this.focusQueue.push({ kind: 'focus', key, lat, lon, radiusNm })
    // Most recent requests matter most; drop the oldest.
    if (this.focusQueue.length > MAX_PENDING_FOCUS) this.focusQueue.shift()
  }

  private addType(type: string, expected: number) {
    if (this.types.has(type) || this.types.size >= MAX_TYPES) return
    this.types.set(type, { kind: 'type', type, lastPolled: 0, lastCount: expected })
  }

  /** Highest score wins: lots of aircraft × long time since last poll. */
  private nextSweepJob(now: number): TypeJob | MilJob {
    let best: TypeJob | MilJob = this.mil
    let bestScore = (this.mil.lastCount + 5) * (now - this.mil.lastPolled)
    for (const job of this.types.values()) {
      // sqrt keeps rare types from starving while still favouring busy ones.
      const score = Math.sqrt(job.lastCount + 5) * (now - job.lastPolled)
      if (score > bestScore) {
        best = job
        bestScore = score
      }
    }
    return best
  }

  private async tick() {
    const now = Date.now()
    const useFocus = this.focusQueue.length > 0 && this.preferFocus
    const job = useFocus ? this.focusQueue.pop()! : this.nextSweepJob(now)
    this.preferFocus = !useFocus // alternate so the global sweep never stalls

    try {
      let result
      if (job.kind === 'focus') {
        this.focusDone.set(job.key, now)
        result = await byPoint(job.lat, job.lon, job.radiusNm)
        // Learn new aircraft types from regional data.
        for (const ac of result) if (ac[7]) this.addType(ac[7], 1)
      } else {
        job.lastPolled = now
        result = job.kind === 'mil' ? await military() : await byType(job.type)
        job.lastCount = result.length
      }
      for (const ac of result) this.store.upsert(ac, 'adsb.lol')
      this.lastFetch = Date.now()
      this.rateLimited = false
      this.interval = Math.max(MIN_INTERVAL, this.interval * 0.97)
    } catch (err) {
      if (err instanceof RateLimitedError) {
        this.rateLimited = true
        this.pausedUntil = Date.now() + err.retryAfterSec * 1000
        this.interval = Math.min(MAX_INTERVAL, this.interval * 1.25)
        console.warn(`[scheduler] ${err.message}; interval now ${Math.round(this.interval)}ms`)
      } else {
        console.warn('[scheduler]', (err as Error).message)
      }
      // Put an interrupted focus request back so it isn't lost.
      if (job.kind === 'focus') this.focusDone.delete(job.key)
      else job.lastPolled = now - this.interval // retry soon-ish, but not immediately
    }
    for (const [k, t] of this.focusDone) if (now - t > FOCUS_COOLDOWN_MS * 3) this.focusDone.delete(k)
  }
}
