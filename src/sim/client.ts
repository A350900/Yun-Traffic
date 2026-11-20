// Simulated traffic: main-thread side. Starts/stops the background worker,
// sends it live aircraft counts per cell, asks for frames at the same pace
// as the live aircraft redraw, and puts the result on the map.
import type { Map as MLMap } from 'maplibre-gl'
import { cellKey } from '../../shared/sim/regions'
import { addSimLayer, removeSimLayer, setSimData, setAreasVisible } from './layer'
import type { FromWorker, SimStats, ToWorker, ViewWindow } from './worker'
import type { AircraftTuple } from '../../shared/wire'

const LIVE_EVERY_MS = 30_000
/**
 * Live aircraft reported within this time count as "seen live" when filling
 * gaps (OpenSky snapshots can be ~10 min apart without an account).
 */
const FRESH_MS = 20 * 60_000

export class SimController {
  private worker: Worker | null = null
  private map: MLMap | null = null
  private waiting = false
  // -Infinity = never (performance.now() starts near 0 at page load, so 0 would mean "just now")
  private lastFrame = -Infinity
  private lastLive = -Infinity
  /** how many live aircraft the last counts were based on (-1: none sent) */
  private liveSent = -1
  private nextId = 0
  private listeners = new Set<() => void>()
  stats: SimStats | null = null
  error: string | null = null

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private notify() {
    for (const fn of this.listeners) fn()
  }

  get enabled() {
    return this.map !== null
  }

  private showAreas = false

  /** Outline the gap areas on the map (Settings: "Show simulation areas"). */
  setShowAreas(show: boolean) {
    this.showAreas = show
    if (this.map) setAreasVisible(this.map, show)
  }

  /** Start the worker early (it prepares the schedule while the map loads). */
  preload() {
    if (this.worker) return
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data
      if (msg.type === 'frame') {
        this.waiting = false
        if (this.map) setSimData(this.map, msg.text)
        this.stats = msg.stats
      } else if (msg.type === 'ready') {
        this.stats = msg.stats
      } else if (msg.type === 'error') {
        this.error = msg.message
        console.warn('[sim]', msg.message)
      }
      this.notify()
    }
  }

  enable(map: MLMap, beforeLayer?: string) {
    if (this.map) return
    this.preload()
    this.map = map
    addSimLayer(map, beforeLayer)
    setAreasVisible(map, this.showAreas)
    this.lastFrame = -Infinity
    this.lastLive = -Infinity
    this.liveSent = -1
  }

  disable() {
    this.worker?.terminate()
    this.worker = null
    this.waiting = false
    if (this.map) removeSimLayer(this.map)
    this.map = null
    this.stats = null
    this.notify()
  }

  /**
   * Called from the map's redraw loop. Requests a new frame when `interval`
   * has passed (or `force`), and keeps the worker's live counts current.
   */
  tick(opts: { now: number; view: ViewWindow | null; interval: number; force?: boolean; aircraft: Iterable<AircraftTuple>; liveCount?: number }) {
    if (!this.worker || !this.map) return
    const t = performance.now()
    // Live counts every 30 s, and straight away once the first live data is in
    // (so simulated aircraft never double up on live ones for long).
    const liveCount = opts.liveCount ?? 0
    if (t - this.lastLive >= LIVE_EVERY_MS || (this.liveSent <= 0 && liveCount > 0)) {
      this.lastLive = t
      this.liveSent = liveCount
      const cells: Record<string, number> = {}
      for (const ac of opts.aircraft) {
        if (opts.now - ac[9] > FRESH_MS) continue
        const k = cellKey(ac[1], ac[2])
        cells[k] = (cells[k] ?? 0) + 1
      }
      this.post({ type: 'live', cells })
      this.lastFrame = -Infinity // new live data: refresh now
    }
    if (this.waiting || (!opts.force && t - this.lastFrame < opts.interval)) return
    this.waiting = true
    this.lastFrame = t
    this.post({ type: 'frame', id: ++this.nextId, t: opts.now, view: opts.view })
  }

  private post(msg: ToWorker) {
    this.worker?.postMessage(msg)
  }
}
