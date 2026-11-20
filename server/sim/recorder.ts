// Simulated traffic (phase 0): records what the live data covers.
//
// Every 5 minutes:
//  - coverage: for each 2° cell, the average number of live aircraft seen
//    there for each hour of the day (rolling ~7-day average), plus how often
//    any are seen. Compared later with the model's EXPECTED traffic for the
//    same cell and hour: where live sees most of it, the cell is "covered"
//    and never gets simulated traffic.
//  - totals: live aircraft overall and per region, kept 7 days (Stats graph)
//  - airlines: callsign prefixes seen flying (cleans the route data)
//
// Saved to .cache/sim/recorder.json. No API calls.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cellKey, regionOf } from '../../shared/sim/regions.ts'
import type { AircraftStore } from '../store.ts'

const SAMPLE_MS = 5 * 60_000
const SAMPLES_PER_DAY = 288
const KEEP_SAMPLES = 7 * SAMPLES_PER_DAY
/** Weight of each new sample in the rolling coverage average (~7-day memory). */
const ALPHA = 1 / KEEP_SAMPLES
/** Positions reported within this time count as "seen live" (OpenSky snapshots can be ~10 min apart). */
const FRESH_MS = 20 * 60_000
const FILE = join(import.meta.dirname, '..', '..', '.cache', 'sim', 'recorder.json')
const SEED_FILE = join(import.meta.dirname, '..', '..', 'data', 'sim', 'coverage-seed.json')

export interface Sample {
  /** epoch ms */
  t: number
  total: number
  regions: Record<string, number>
}

export interface CellCoverage {
  /** share of samples with any live aircraft (rolling) */
  p: number
  /** average live aircraft by UTC hour 0..23 (rolling); null = not measured yet */
  h: (number | null)[]
}

/** As stored: every hour has a number (0 until sampled; see hourSamples). */
interface StoredCell {
  p: number
  h: number[]
}

interface Saved {
  samples: number
  /** samples taken so far for each UTC hour */
  hourSamples: number[]
  cells: Record<string, StoredCell>
  series: Sample[]
  /** airline ICAO prefix -> last day seen (YYYY-MM-DD) */
  airlines: Record<string, string>
}

export class SimRecorder {
  private data: Saved = { samples: 0, hourSamples: Array(24).fill(0), cells: {}, series: [], airlines: {} }
  private store: AircraftStore

  constructor(store: AircraftStore) {
    this.store = store
    try {
      const saved = JSON.parse(readFileSync(FILE, 'utf8'))
      // Older format (no per-hour data): start the coverage part fresh.
      const sample = Object.values(saved.cells ?? {})[0]
      if (Array.isArray(sample)) {
        saved.cells = {}
        saved.samples = 0
      }
      this.data = { ...this.data, ...saved }
    } catch {
      /* first run */
    }
  }

  start() {
    // First sample after the live sources have had a minute to fill in.
    setTimeout(() => this.sample(), 90_000)
    setInterval(() => this.sample(), SAMPLE_MS)
  }

  get status() {
    return { samples: this.data.samples, days: +(this.data.samples / SAMPLES_PER_DAY).toFixed(1), cells: Object.keys(this.data.cells).length, airlines: Object.keys(this.data.airlines).length }
  }

  /**
   * Rolling coverage per cell. Until a full day has been recorded, a bundled
   * seed (a few snapshots) fills in, blended out as our own data grows.
   */
  coverage(): { samples: number; seed: boolean; hourSamples: number[]; cells: Record<string, CellCoverage> } {
    const own = { samples: this.data.samples, hourSamples: this.data.hourSamples }
    const measured = (c: StoredCell | undefined): CellCoverage => ({
      p: c?.p ?? 0,
      // Hours never sampled are unknown, not zero.
      h: Array.from({ length: 24 }, (_, hr) => (this.data.hourSamples[hr] > 0 ? (c?.h[hr] ?? 0) : null)),
    })
    const allKeys = (extra: string[] = []) => new Set([...Object.keys(this.data.cells), ...extra])
    if (this.data.samples >= SAMPLES_PER_DAY) {
      const cells: Record<string, CellCoverage> = {}
      for (const k of allKeys()) cells[k] = measured(this.data.cells[k])
      return { ...own, seed: false, cells }
    }
    // Fresh install: the bundled seed fills in the hour(s) it was captured at.
    let seed: { cells: Record<string, [number, number]>; hours?: number[] } = { cells: {} }
    try {
      seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'))
    } catch {
      /* no seed */
    }
    const w = this.data.samples / SAMPLES_PER_DAY
    const seedHours = new Set(seed.hours ?? [])
    const cells: Record<string, CellCoverage> = {}
    for (const k of allKeys(Object.keys(seed.cells))) {
      const sd = seed.cells[k]
      const c = measured(this.data.cells[k])
      cells[k] = {
        p: (sd?.[0] ?? 0) * (1 - w) + c.p * w,
        h: c.h.map((v, hr) => (v == null && seedHours.has(hr) ? (sd?.[1] ?? 0) : v)),
      }
    }
    return { ...own, seed: Object.keys(seed.cells).length > 0, cells }
  }

  series(): Sample[] {
    return this.data.series
  }

  airlinesSeen(): string[] {
    return Object.keys(this.data.airlines).sort()
  }

  private sample() {
    const now = Date.now()
    const counts = new Map<string, number>()
    const regions: Record<string, number> = {}
    let total = 0
    const today = new Date(now).toISOString().slice(0, 10)
    this.store.forEach((ac) => {
      if (now - ac[9] > FRESH_MS) return
      total++
      const k = cellKey(ac[1], ac[2])
      counts.set(k, (counts.get(k) ?? 0) + 1)
      const r = regionOf(ac[1], ac[2])
      regions[r] = (regions[r] ?? 0) + 1
      const prefix = ac[6]?.match(/^([A-Z]{3})\d/)?.[1]
      if (prefix) this.data.airlines[prefix] = today
    })

    // Rolling averages (early on, simply the average of the samples so far).
    const hour = new Date(now).getUTCHours()
    const a = Math.max(ALPHA, 1 / (this.data.samples + 1))
    const ah = Math.max(1 / (KEEP_SAMPLES / 24), 1 / (this.data.hourSamples[hour] + 1))
    for (const [k, v] of Object.entries(this.data.cells)) {
      const c = counts.get(k) ?? 0
      v.p = v.p * (1 - a) + (c > 0 ? a : 0)
      v.h[hour] = v.h[hour] * (1 - ah) + c * ah
      counts.delete(k)
    }
    for (const [k, c] of counts) {
      const h = Array(24).fill(0)
      h[hour] = c * ah
      this.data.cells[k] = { p: a, h }
    }
    // Drop cells that have gone quiet everywhere, and round to keep the file small.
    for (const [k, v] of Object.entries(this.data.cells)) {
      if (v.p < 0.001 && v.h.every((x) => x < 0.01)) delete this.data.cells[k]
      else {
        v.p = Math.round(v.p * 1e4) / 1e4
        v.h = v.h.map((x) => Math.round(x * 100) / 100)
      }
    }
    this.data.samples++
    this.data.hourSamples[hour]++

    this.data.series.push({ t: now, total, regions })
    if (this.data.series.length > KEEP_SAMPLES) this.data.series.splice(0, this.data.series.length - KEEP_SAMPLES)
    // Forget airlines not seen for 60 days.
    const cutoff = new Date(now - 60 * 86_400_000).toISOString().slice(0, 10)
    for (const [p, d] of Object.entries(this.data.airlines)) if (d < cutoff) delete this.data.airlines[p]

    try {
      mkdirSync(join(FILE, '..'), { recursive: true })
      writeFileSync(FILE, JSON.stringify(this.data))
    } catch (err) {
      console.warn('[sim] could not save recorder data:', (err as Error).message)
    }
  }
}
