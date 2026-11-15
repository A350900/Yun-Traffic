import type { AircraftTuple } from '../shared/wire.ts'

/** How long an aircraft may go without a fresh position before it's dropped. */
const MAX_AGE_MS = 12 * 60_000
/** How long removal records are kept so clients can catch up via deltas. */
const TOMBSTONE_MS = 30 * 60_000

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

  upsert(ac: AircraftTuple) {
    const existing = this.entries.get(ac[0])
    // Never replace a newer position with an older one (different queries
    // can return the same aircraft with different data ages).
    if (existing && existing.data[9] >= ac[9]) return
    this.version++
    this.entries.set(ac[0], { data: ac, version: this.version })
    this.tombstones.delete(ac[0])
  }

  prune(now = Date.now()) {
    for (const [hex, e] of this.entries) {
      if (now - e.data[9] > MAX_AGE_MS) {
        this.entries.delete(hex)
        this.version++
        this.tombstones.set(hex, { version: this.version, at: now })
      }
    }
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
