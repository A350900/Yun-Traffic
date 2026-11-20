// Simulated traffic: where it's allowed.
//
// Each 2° cell gets a class by comparing what live data sees there (the
// server's recorder: average live aircraft per UTC hour, rolling ~7 days)
// with what the model expects for the same cell and hour:
//   covered  live sees most of the expected traffic at the cell's best
//            measured hour, or live aircraft are almost always there and
//            it isn't clearly a gap -> never simulated (US, Europe, ...)
//   partial  live sees some of it -> only the difference is filled
//   gap      live sees little or none -> filled fully (oceans, China, ...)

import { SIM_CONFIG } from './config'

export type CellClass = 'covered' | 'partial' | 'gap'

/**
 * From /api/sim/coverage: per cell, share of samples with live aircraft and
 * average live count by UTC hour. `null` = that hour hasn't been measured yet.
 */
export interface LiveCoverage {
  cells: Record<string, { p: number; h: (number | null)[] }>
}

/** Expected (model) aircraft per cell for each UTC hour 0..23. */
export type ExpectedGrid = Map<string, number[]>

export function classifyCells(live: LiveCoverage, expected: ExpectedGrid): Map<string, CellClass> {
  const out = new Map<string, CellClass>()
  const { coveredRatio, gapRatio, minExpected, alwaysSeen } = SIM_CONFIG
  const keys = new Set([...expected.keys(), ...Object.keys(live.cells)])
  for (const k of keys) {
    const exp = expected.get(k) ?? Array(24).fill(0)
    const lv = live.cells[k]
    const p = lv?.p ?? 0
    // Receivers don't move: judge coverage at the cell's best MEASURED hour
    // with meaningful expected traffic. This is robust to the model being
    // off at some hours (e.g. its nights are a bit too busy).
    let best = -1
    for (let h = 0; h < 24; h++) {
      const v = lv?.h[h]
      if (v == null || exp[h] < minExpected) continue
      best = Math.max(best, v / exp[h])
    }
    let cls: CellClass
    if (best < 0) {
      // No measured hour with real traffic expected: judge by how often live aircraft show up.
      cls = p >= 0.5 ? 'covered' : p >= 0.15 ? 'partial' : 'gap'
    } else {
      cls = best >= coveredRatio ? 'covered' : best >= gapRatio ? 'partial' : 'gap'
      // Safety net: live aircraft seen there almost all the time, and not clearly a gap -> covered.
      if (cls === 'partial' && p >= alwaysSeen) cls = 'covered'
    }
    out.set(k, cls)
  }
  return out
}

/** Share (0..1) of the model's aircraft to show in a cell right now. */
export function fillFraction(cls: CellClass | undefined, liveNow: number, expectedNow: number): number {
  if (cls === 'covered' || expectedNow <= 0) return 0
  return Math.min(1, Math.max(0, (expectedNow - liveNow) / expectedNow))
}
