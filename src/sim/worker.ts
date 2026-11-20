/// <reference lib="webworker" />
// Simulated traffic: runs in a background thread so the map never waits.
//
// Simulated aircraft only appear inside the hard boundary of gap areas
// (data/sim/gap-areas.json). For each frame: position every simulated flight,
// and in each 2° cell inside the boundary show enough of them to fill the
// difference between the traffic the model expects and the live aircraft
// actually there (so we never double up on live traffic). The result is sent
// back as ready-to-use GeoJSON text.

import routes from '../../data/sim/routes.json'
import airports from '../../data/airports.json'
import trafficModel from '../../data/sim/traffic-model.json'
import calibration from '../../data/sim/calibration.json'
import { SimModel } from './model'
import gapAreas from '../../data/sim/gap-areas.json'
import { AreaMask, type GapArea } from './areas'
import { DEFAULT_TYPE_NAMES, sizeClass } from './schedule'
import { hash } from './random'
import { SIM_CONFIG } from './config'
import { cellKey } from '../../shared/sim/regions'
import type { SimData } from './types'

export interface ViewWindow {
  centerLon: number
  halfLon: number
  south: number
  north: number
}

export type ToWorker =
  | { type: 'live'; cells: Record<string, number> }
  | { type: 'frame'; id: number; t: number; view: ViewWindow | null }

export interface SimStats {
  /** simulated flights in the air worldwide (model) */
  airborne: number
  /** shown on the map (inside gap areas, not duplicating live traffic) */
  shown: number
}

export type FromWorker =
  | { type: 'ready'; stats: SimStats }
  | { type: 'frame'; id: number; text: string; stats: SimStats }
  | { type: 'error'; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope
const model = new SimModel({ routes, airports, model: trafficModel, calibration } as unknown as SimData)
const SIZE = { turboprop: 0.75, regional: 0.82, narrowbody: 0.92, widebody: 1.15 } as const

const mask = new AreaMask(gapAreas.areas as GapArea[])
let liveNow: Record<string, number> = {}

/** Share (0..1) of the model's aircraft in a cell to show, given the live aircraft already there. */
function fillFraction(liveCount: number, expectedCount: number) {
  if (expectedCount <= 0) return 0
  return Math.min(1, Math.max(0, (expectedCount - liveCount) / expectedCount))
}

ctx.postMessage({ type: 'ready', stats: { airborne: 0, shown: 0 } } satisfies FromWorker)

function frame(id: number, t: number, view: ViewWindow | null) {
  // Where every simulated flight is now, and how many the model puts in each cell.
  const positions = []
  const expNow = new Map<string, number>()
  for (const f of model.airborne(t)) {
    const p = model.position(f, t)
    const k = cellKey(p.lat, p.lon)
    expNow.set(k, (expNow.get(k) ?? 0) + 1)
    positions.push({ p, k })
  }

  const parts: string[] = []
  for (const { p, k } of positions) {
    if (p.visibility <= 0) continue // near an airport: never shown
    const area = mask.at(p.lat, p.lon)
    if (area <= 0) continue // outside the gap areas: never shown
    const frac = fillFraction(liveNow[k] ?? 0, expNow.get(k) ?? 0)
    // Stable choice: the same flights stay selected as long as the fill level is similar.
    const u = hash(`${p.flight.route}|${p.flight.dep}`) / 4294967296
    if (u >= frac) continue
    if (view) {
      const dLon = ((p.lon - view.centerLon + 540) % 360) - 180
      if (dLon > view.halfLon || dLon < -view.halfLon || p.lat < view.south || p.lat > view.north) continue
    }
    const r = p.route
    const airline = model.airlines[r.airline]
    const type = p.flight.type
    parts.push(
      `{"type":"Feature","geometry":{"type":"Point","coordinates":[${p.lon.toFixed(4)},${p.lat.toFixed(4)}]},` +
        `"properties":{"id":"${p.flight.route}-${p.flight.dep}","rot":${Math.round(p.track)},"s":${SIZE[sizeClass(type)]},` +
        `"v":${(p.visibility * area * SIM_CONFIG.opacity).toFixed(2)},"al":${JSON.stringify(airline?.[0] || airline?.[1] || '')},` +
        `"an":${JSON.stringify(airline?.[2] ?? '')},"t":"${type}","tn":${JSON.stringify(model.aircraftNames[type] ?? DEFAULT_TYPE_NAMES[type] ?? type)},` +
        `"dep":"${r.dep}","arr":"${r.arr}","alt":${p.altitudeFt},"spd":${p.speedKt},` +
        `"d0":${p.flight.dep},"d1":${p.flight.arr}}}`,
    )
  }
  const stats: SimStats = { airborne: positions.length, shown: parts.length }
  ctx.postMessage({ type: 'frame', id, text: `{"type":"FeatureCollection","features":[${parts.join(',')}]}`, stats } satisfies FromWorker)
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'live') liveNow = msg.cells
  else if (msg.type === 'frame') {
    try {
      frame(msg.id, msg.t, msg.view)
    } catch (err) {
      ctx.postMessage({ type: 'error', message: (err as Error).message } satisfies FromWorker)
    }
  }
}
