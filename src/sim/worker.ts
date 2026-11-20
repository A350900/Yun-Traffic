/// <reference lib="webworker" />
// Simulated traffic: runs in a background thread so the map never waits.
//
// On start (and once a day): build the timetable, compute the traffic the
// model expects in each 2° cell for every UTC hour, and classify cells
// (covered / partial / gap) against the live coverage the server recorded.
// For each frame: position every simulated flight, and in each non-covered
// cell show enough of them to fill the gap between expected and live traffic.
// The result is sent back as ready-to-use GeoJSON text.

import routes from '../../data/sim/routes.json'
import airports from '../../data/airports.json'
import trafficModel from '../../data/sim/traffic-model.json'
import calibration from '../../data/sim/calibration.json'
import { SimModel } from './model'
import { classifyCells, fillFraction, type CellClass, type LiveCoverage, type ExpectedGrid } from './coverage'
import { sizeClass } from './schedule'
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
  airborne: number
  shown: number
  cells: { covered: number; partial: number; gap: number }
  /** Coverage data comes from the bundled seed (fresh install) rather than recorded history. */
  seed: boolean
}

export type FromWorker =
  | { type: 'ready'; stats: SimStats }
  | { type: 'frame'; id: number; text: string; stats: SimStats }
  | { type: 'error'; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope
const model = new SimModel({ routes, airports, model: trafficModel, calibration } as unknown as SimData)
const SIZE = { turboprop: 0.75, regional: 0.82, narrowbody: 0.92, widebody: 1.15 } as const

let classes = new Map<string, CellClass>()
let expectedDay = ''
let expected: ExpectedGrid = new Map()
let liveCoverage: LiveCoverage = { cells: {} }
let seed = false
let liveNow: Record<string, number> = {}
let ready = false

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Expected aircraft per cell for each UTC hour of the day containing `t`. */
function computeExpected(t: number) {
  const start = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate())
  const grid: ExpectedGrid = new Map()
  for (let h = 0; h < 24; h++) {
    const at = start + h * 3600_000 + 30 * 60_000
    for (const f of model.airborne(at)) {
      const p = model.position(f, at)
      const k = cellKey(p.lat, p.lon)
      let row = grid.get(k)
      if (!row) grid.set(k, (row = Array(24).fill(0)))
      row[h]++
    }
  }
  expected = grid
  expectedDay = dayKey(t)
}

async function loadCoverage() {
  try {
    const res = await fetch('/api/sim/coverage')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as LiveCoverage & { seed: boolean }
    liveCoverage = body
    seed = body.seed
  } catch (err) {
    ctx.postMessage({ type: 'error', message: `coverage: ${(err as Error).message}` } satisfies FromWorker)
  }
  classes = classifyCells(liveCoverage, expected)
}

function cellCounts() {
  const c = { covered: 0, partial: 0, gap: 0 }
  for (const v of classes.values()) c[v]++
  return c
}

async function init() {
  computeExpected(Date.now())
  await loadCoverage()
  ready = true
  ctx.postMessage({ type: 'ready', stats: { airborne: 0, shown: 0, cells: cellCounts(), seed } } satisfies FromWorker)
  // The server's coverage keeps learning: refresh every 30 minutes.
  setInterval(() => void loadCoverage(), 30 * 60_000)
}

function frame(id: number, t: number, view: ViewWindow | null) {
  if (dayKey(t) !== expectedDay) {
    computeExpected(t)
    classes = classifyCells(liveCoverage, expected)
  }
  // Where every simulated flight is now, and how much the model expects per cell.
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
    const frac = fillFraction(classes.get(k), liveNow[k] ?? 0, expNow.get(k) ?? 0)
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
        `"v":${(p.visibility * SIM_CONFIG.opacity).toFixed(2)},"al":${JSON.stringify(airline?.[0] || airline?.[1] || '')},` +
        `"an":${JSON.stringify(airline?.[2] ?? '')},"t":"${type}","tn":${JSON.stringify(model.aircraftNames[type] ?? type)},` +
        `"dep":"${r.dep}","arr":"${r.arr}","alt":${p.altitudeFt},"spd":${p.speedKt},` +
        `"d0":${p.flight.dep},"d1":${p.flight.arr}}}`,
    )
  }
  const stats: SimStats = { airborne: positions.length, shown: parts.length, cells: cellCounts(), seed }
  ctx.postMessage({ type: 'frame', id, text: `{"type":"FeatureCollection","features":[${parts.join(',')}]}`, stats } satisfies FromWorker)
}

const started = init()
ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'live') liveNow = msg.cells
  else if (msg.type === 'frame') {
    if (!ready) await started
    try {
      frame(msg.id, msg.t, msg.view)
    } catch (err) {
      ctx.postMessage({ type: 'error', message: (err as Error).message } satisfies FromWorker)
    }
  }
}
