import type { AircraftTuple } from '../shared/wire.ts'

/** How long an aircraft may go without a fresh position before it's dropped. */
const MAX_AGE_MS = 12 * 60_000
/** How long removal records are kept so clients can catch up via deltas. */
const TOMBSTONE_MS = 30 * 60_000

/** Remember aircraft type/registration for a day, so sources that don't send them (OpenSky) can be filled in. */
const META_TTL_MS = 24 * 60 * 60_000

interface Meta {
  type: string | null
  reg: string | null
  category: string | null
  at: number
}

/** Where a position came from (for coverage stats). */
export type SourceName = 'opensky' | 'adsb.fi' | 'adsb.lol'
const SOURCES: SourceName[] = ['opensky', 'adsb.fi', 'adsb.lol']
/** Window for "which sources have seen this aircraft recently". */
const SEEN_WINDOW_MS = 15 * 60_000

interface Entry {
  data: AircraftTuple
  version: number
}

/**
 * In-memory aircraft table with versioning, so clients can ask for
 * "everything that changed since version N" instead of a full snapshot.
 */
export class AircraftStore {
  private entries = new Map<string, Entry>()
  private meta = new Map<string, Meta>()
  /** source -> (hex -> last time that source reported it) */
  private seen = new Map<SourceName, Map<string, number>>(SOURCES.map((src) => [src, new Map()]))
  private tombstones = new Map<string, { version: number; at: number }>()
  private version = 0
  /** Oldest version a delta can still be computed from */
  private floor = 0

  get currentVersion() {
    return this.version
  }

  get size() {
    return this.entries.size
  }

  /**
   * Per source: how many current aircraft it reported in the last 15 min,
   * and how many of those no other source reported (its unique contribution).
   */
  coverage() {
    const out: Record<string, { seen: number; onlyThisSource: number }> = {}
    for (const src of SOURCES) out[src] = { seen: 0, onlyThisSource: 0 }
    for (const hex of this.entries.keys()) {
      const by = SOURCES.filter((src) => this.seen.get(src)!.has(hex))
      for (const src of by) out[src].seen++
      if (by.length === 1) out[by[0]].onlyThisSource++
    }
    return out
  }

  get(hex: string): AircraftTuple | undefined {
    return this.entries.get(hex)?.data
  }

  forEach(fn: (ac: AircraftTuple) => void) {
    for (const e of this.entries.values()) fn(e.data)
  }

  upsert(ac: AircraftTuple, source: SourceName) {
    const hex = ac[0]
    this.seen.get(source)!.set(hex, Date.now())
    // Learn type/registration/category from whichever source has them.
    if (ac[7] || ac[8]) {
      const m = this.meta.get(hex)
      this.meta.set(hex, { type: ac[7] ?? m?.type ?? null, reg: ac[8] ?? m?.reg ?? null, category: ac[11] ?? m?.category ?? null, at: Date.now() })
    }

    const existing = this.entries.get(hex)
    // Never replace a newer position with an older one (the sources and
    // queries overlap, and return the same aircraft with different ages).
    if (existing && existing.data[9] >= ac[9]) {
      // ...but an older report can still fill in details the newer one lacks.
      const d = existing.data
      if ((!d[7] && ac[7]) || (!d[8] && ac[8]) || (!d[11] && ac[11])) {
        existing.data = [...d] as AircraftTuple
        existing.data[7] ??= ac[7]
        existing.data[8] ??= ac[8]
        existing.data[11] ??= ac[11]
        existing.version = ++this.version
      }
      return
    }

    const merged = [...ac] as AircraftTuple
    // Fields one source has and the other doesn't: keep what we already knew.
    const m = this.meta.get(hex)
    merged[6] ??= existing?.data[6] ?? null // callsign
    merged[7] ??= existing?.data[7] ?? m?.type ?? null // type
    merged[8] ??= existing?.data[8] ?? m?.reg ?? null // registration
    merged[10] ??= existing?.data[10] ?? null // squawk
    merged[11] ??= existing?.data[11] ?? m?.category ?? null // category
    merged[12] ??= existing?.data[12] ?? null // vertical rate

    this.version++
    this.entries.set(hex, { data: merged, version: this.version })
    this.tombstones.delete(hex)
  }

  prune(now = Date.now()) {
    for (const [hex, e] of this.entries) {
      if (now - e.data[9] > MAX_AGE_MS) {
        this.entries.delete(hex)
        this.version++
        this.tombstones.set(hex, { version: this.version, at: now })
      }
    }
    for (const [hex, m] of this.meta) if (now - m.at > META_TTL_MS) this.meta.delete(hex)
    for (const map of this.seen.values()) for (const [hex, t] of map) if (now - t > SEEN_WINDOW_MS) map.delete(hex)
    for (const [hex, t] of this.tombstones) {
      if (now - t.at > TOMBSTONE_MS) {
        this.tombstones.delete(hex)
        this.floor = Math.max(this.floor, t.version)
      }
    }
  }

  /** Returns a delta since `since`, or a full snapshot if that's impossible. */
  changesSince(since: number | null) {
    const full = since == null || since < this.floor || since > this.version
    const aircraft: AircraftTuple[] = []
    const removed: string[] = []
    for (const e of this.entries.values()) {
      if (full || e.version > since!) aircraft.push(e.data)
    }
    if (!full) {
      for (const [hex, t] of this.tombstones) if (t.version > since!) removed.push(hex)
    }
    return { full, aircraft, removed, version: this.version }
  }
}
