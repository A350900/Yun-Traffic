import type { FlightInfo, FlightPhoto, FlightTrace } from '../../shared/wire'
import { distanceKm } from './geo'

/**
 * Details for the selected aircraft: loaded once per selection (route,
 * airline, model; the photo separately so it never holds up the route), with
 * the flown path refreshed every 30 s.
 * Shared by the details panel and the map's path layer.
 */

export interface SelectionState {
  hex: string | null
  info: FlightInfo | null
  infoLoading: boolean
  trace: FlightTrace | null
  /** undefined while loading */
  photo: FlightPhoto | undefined
  /** Departure airport checked against the flown path (by the server or here) */
  originChecked: boolean
}

const TRACE_REFRESH_MS = 30_000
const TRACE_RETRY_MS = 2500

export class SelectionStore {
  private state: SelectionState = { hex: null, info: null, infoLoading: false, trace: null, photo: undefined, originChecked: false }
  private listeners = new Set<() => void>()
  private traceTimer = 0
  private retryTimer = 0
  private callsign: string | null = null
  private aborter: AbortController | null = null

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getState = () => this.state
  private set(patch: Partial<SelectionState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  /** Select an aircraft (or null). `callsign` lets us refetch if it changes mid-flight. */
  select(hex: string | null, callsign: string | null, typeCode: string | null = null, reg: string | null = null) {
    if (hex === this.state.hex && callsign === this.callsign) return
    const sameAircraft = hex === this.state.hex
    this.callsign = callsign
    this.aborter?.abort()
    clearInterval(this.traceTimer)
    clearTimeout(this.retryTimer)
    if (!hex) return this.set({ hex: null, info: null, infoLoading: false, trace: null, photo: undefined, originChecked: false })

    this.aborter = new AbortController()
    const signal = this.aborter.signal
    this.set({ hex, infoLoading: true, ...(sameAircraft ? {} : { info: null, trace: null, photo: undefined, originChecked: false }) })

    if (!sameAircraft) {
      fetch(`/api/photo/${hex}${reg ? `?reg=${encodeURIComponent(reg)}` : ''}`, { signal })
        .then((r) => (r.ok ? (r.json() as Promise<FlightPhoto>) : null))
        .then((photo) => !signal.aborted && this.set({ photo }))
        .catch(() => !signal.aborted && this.set({ photo: null }))
    }

    const params = new URLSearchParams()
    if (callsign) params.set('cs', callsign)
    if (typeCode) params.set('t', typeCode)
    const qs = params.size ? `?${params}` : ''
    const loadInfo = () =>
      fetch(`/api/flight/${hex}${qs}`, { signal })
        .then((r) => (r.ok ? (r.json() as Promise<FlightInfo>) : null))
        .then((info) => {
          if (signal.aborted) return
          this.set({ info, infoLoading: false, originChecked: this.state.originChecked || Boolean(info?.route?.verified) })
          checkOrigin()
        })
        .catch(() => !signal.aborted && this.set({ infoLoading: false }))
    void loadInfo()

    let rechecked = false
    // The server double-checks the departure airport against the flown path,
    // but doesn't wait long for the path. Once we have it, compare ourselves:
    // if it took off somewhere else, ask again (the corrected answer is cached).
    const checkOrigin = () => {
      const { info, trace } = this.state
      const origin = info?.route?.origin
      const start = trace?.hex === hex ? trace.points[0] : undefined
      if (!origin || !trace || trace.hex !== hex || this.state.originChecked) return
      if (trace.partial) return // only the last few minutes so far; wait for the full path
      const startsLow = start && (start[3] === -1 || start[3] < 4000)
      if (!rechecked && start && startsLow && distanceKm(start[1], start[2], origin.lat, origin.lon) > 25) {
        rechecked = true
        void loadInfo()
      } else {
        this.set({ originChecked: true })
      }
    }
    const loadTrace = (): Promise<void> =>
      fetch(`/api/trace/${hex}`, { signal })
        .then((r) => (r.ok ? (r.json() as Promise<FlightTrace>) : null))
        .then((trace) => {
          if (signal.aborted || !trace) return
          this.set({ trace })
          // Path history incomplete (source busy): try again shortly.
          if (trace.partial) {
            clearTimeout(this.retryTimer)
            this.retryTimer = window.setTimeout(() => void loadTrace(), TRACE_RETRY_MS)
          }
          checkOrigin()
        })
        .catch(() => {})
    void loadTrace()
    this.traceTimer = window.setInterval(() => void loadTrace(), TRACE_REFRESH_MS)
  }
}
