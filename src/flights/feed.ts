import { extrapolate } from './position'
import { F, type AircraftResponse, type AircraftTuple, type FeedStats } from '../../shared/wire'

export type AircraftMap = Map<string, AircraftTuple>

export interface FeedState {
  aircraft: AircraftMap
  /** serverClock - clientClock, ms */
  clockOffset: number
  stats: FeedStats | null
  error: string | null
  /** Incremented on every successful update */
  revision: number
}

export interface FocusHint {
  lat: number
  lon: number
  radiusNm: number
}

const POLL_MS = 3000

/**
 * Polls /api/aircraft for deltas and keeps a live table of aircraft.
 * Not a React hook on purpose: the map reads it every animation tick and
 * we don't want 10k-row updates going through React state.
 */
export function startFeed(getFocus: () => FocusHint | null, onUpdate: (s: FeedState) => void) {
  const state: FeedState = { aircraft: new Map(), clockOffset: 0, stats: null, error: null, revision: 0 }
  let version: number | null = null
  let stopped = false
  let timer = 0
  let controller: AbortController | null = null

  const poll = async () => {
    const params = new URLSearchParams()
    if (version != null) params.set('since', String(version))
    const focus = getFocus()
    if (focus) params.set('focus', `${focus.lat.toFixed(2)},${focus.lon.toFixed(2)},${Math.round(focus.radiusNm)}`)

    controller = new AbortController()
    try {
      const res = await fetch(`/api/aircraft?${params}`, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as AircraftResponse
      if (body.full) state.aircraft.clear()
      for (const ac of body.aircraft) state.aircraft.set(ac[F.Hex], ac)
      for (const hex of body.removed) state.aircraft.delete(hex)
      version = body.version
      state.clockOffset = body.now - Date.now()
      state.stats = body.stats
      state.error = null
      state.revision++
    } catch (err) {
      if (stopped) return
      state.error = (err as Error).message
    }
    onUpdate(state)
    if (!stopped) timer = window.setTimeout(poll, POLL_MS)
  }
  poll()

  return {
    state,
    stop() {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
    },
  }
}

/**
 * Synthetic traffic for load-testing the renderer (`?stress=20000`).
 * Planes fly great-circle-ish straight lines at realistic speeds.
 */
export function startStressFeed(count: number, onUpdate: (s: FeedState) => void) {
  const state: FeedState = { aircraft: new Map(), clockOffset: 0, stats: null, error: null, revision: 1 }
  const now = Date.now()
  const types = ['A20N', 'B738', 'A321', 'B77W', 'B789', 'E75L', 'A359', 'C172', 'R44']
  // Bias towards the busy northern-hemisphere bands so it looks like real traffic.
  for (let i = 0; i < count; i++) {
    const hex = (0x100000 + i).toString(16)
    const lat = Math.max(-60, Math.min(70, (Math.random() + Math.random() + Math.random()) * 45 - 40))
    const lon = Math.random() * 360 - 180
    const heli = i % 60 === 0
    const ground = i % 25 === 0
    state.aircraft.set(hex, [
      hex, lat, lon, Math.random() * 360,
      ground ? 12 : heli ? 110 : 300 + Math.random() * 220,
      ground ? -1 : heli ? 1500 : 3000 + Math.round(Math.random() * 38000),
      `TST${i}`, types[i % types.length], `N${i}TS`, now, null, heli ? 'A7' : 'A3', 0,
    ])
  }
  state.stats = { total: count, lastFetch: now, sweepSeconds: 0, rateLimited: false }
  onUpdate(state)
  // Re-base positions periodically so planes keep flying past the extrapolation cap.
  const timer = window.setInterval(() => {
    const t = Date.now()
    for (const ac of state.aircraft.values()) {
      const [lon, lat] = extrapolate(ac, t)
      ac[F.Lat] = lat
      ac[F.Lon] = lon
      ac[F.PosTime] = t
    }
  }, 60_000)
  return { state, stop: () => clearInterval(timer) }
}
