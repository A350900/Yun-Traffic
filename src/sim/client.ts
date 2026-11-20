// Simulated traffic: main-thread side. Starts/stops the background worker,
// sends it live aircraft counts per cell, asks for frames at the same pace
// as the live aircraft redraw, and puts the result on the map.
import type { Map as MLMap } from 'maplibre-gl'
import { cellKey } from '../../shared/sim/regions'
import { addSimLayer, removeSimLayer, setSimData } from './layer'
import type { FromWorker, SimStats, ToWorker, ViewWindow } from './worker'
import type { AircraftTuple } from '../../shared/wire'

const LIVE_EVERY_MS = 30_000
/** Only fresh live positions count as "seen live" when filling gaps. */
const FRESH_MS = 5 * 60_000

export class SimController {
  private worker: Worker | null = null
  private map: MLMap | null = null
  private waiting = false
  private lastFrame = 0
  private lastLive = 0
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
    return this.worker !== null
  }

  enable(map: MLMap, beforeLayer?: string) {
    if (this.worker) return
    this.map = map
    addSimLayer(map, beforeLayer)
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
    this.lastFrame = 0
    this.lastLive = 0
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
  tick(opts: { now: number; view: ViewWindow | null; interval: number; force?: boolean; aircraft: Iterable<AircraftTuple> }) {
    if (!this.worker) return
    const t = performance.now()
    if (t - this.lastLive >= LIVE_EVERY_MS) {
      this.lastLive = t
      const cells: Record<string, number> = {}
      for (const ac of opts.aircraft) {
        if (opts.now - ac[9] > FRESH_MS) continue
        const k = cellKey(ac[1], ac[2])
        cells[k] = (cells[k] ?? 0) + 1
      }
      this.post({ type: 'live', cells })
      this.lastFrame = 0 // new live data: refresh soon
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
