import type { FlightInfo, FlightTrace } from '../../shared/wire'

/**
 * Details for the selected aircraft: loaded once per selection (route,
 * airline, model, photo), with the flown path refreshed every 30 s.
 * Shared by the details panel and the map's path layer.
 */

export interface SelectionState {
  hex: string | null
  info: FlightInfo | null
  infoLoading: boolean
  trace: FlightTrace | null
}

const TRACE_REFRESH_MS = 30_000

export class SelectionStore {
  private state: SelectionState = { hex: null, info: null, infoLoading: false, trace: null }
  private listeners = new Set<() => void>()
  private traceTimer = 0
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
  select(hex: string | null, callsign: string | null) {
    if (hex === this.state.hex && callsign === this.callsign) return
    const sameAircraft = hex === this.state.hex
    this.callsign = callsign
    this.aborter?.abort()
    clearInterval(this.traceTimer)
    if (!hex) return this.set({ hex: null, info: null, infoLoading: false, trace: null })

    this.aborter = new AbortController()
    const signal = this.aborter.signal
    this.set({ hex, infoLoading: true, ...(sameAircraft ? {} : { info: null, trace: null }) })

    const qs = callsign ? `?cs=${encodeURIComponent(callsign)}` : ''
    fetch(`/api/flight/${hex}${qs}`, { signal })
      .then((r) => (r.ok ? (r.json() as Promise<FlightInfo>) : null))
      .then((info) => !signal.aborted && this.set({ info, infoLoading: false }))
      .catch(() => !signal.aborted && this.set({ infoLoading: false }))

    const loadTrace = () =>
      fetch(`/api/trace/${hex}`, { signal })
        .then((r) => (r.ok ? (r.json() as Promise<FlightTrace>) : null))
        .then((trace) => !signal.aborted && trace && this.set({ trace }))
        .catch(() => {})
    void loadTrace()
    this.traceTimer = window.setInterval(loadTrace, TRACE_REFRESH_MS)
  }
}
