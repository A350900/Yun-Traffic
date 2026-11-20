// Recent positions of every aircraft the server sees, kept compact so a
// clicked aircraft's path can be drawn instantly (before, or without, the
// full history from adsb.lol). Also lets us see takeoffs ourselves.
//
// Per aircraft: Int32 [seconds since BASE, lat*1e5, lon*1e5, altitude ft (-1 = ground)].
// A point is kept when the aircraft has turned, climbed/descended, or a minute
// has passed, so a typical flight needs ~1-2 points a minute (~16 bytes each).

import type { FlightTrace } from '../shared/wire.ts'

const BASE = Math.floor(Date.now() / 1000)
const MAX_POINTS = 900
const MIN_GAP_S = 60
const NEW_FLIGHT_GAP_S = 4 * 3600

class Track {
  data = new Int32Array(64)
  n = 0
  lastTrack: number | null = null
  push(t: number, lat: number, lon: number, alt: number) {
    if ((this.n + 1) * 4 > this.data.length) {
      const bigger = new Int32Array(this.data.length * 2)
      bigger.set(this.data)
      this.data = bigger
    }
    const i = this.n * 4
    this.data[i] = t
    this.data[i + 1] = Math.round(lat * 1e5)
    this.data[i + 2] = Math.round(lon * 1e5)
    this.data[i + 3] = alt
    this.n++
    if (this.n > MAX_POINTS) this.thin()
  }
  /** Drop every other point of the older half (keeps the shape, frees room). */
  thin() {
    const keep: number[] = []
    const half = this.n >> 1
    for (let k = 0; k < this.n; k++) if (k >= half || k % 2 === 0) keep.push(k)
    const out = new Int32Array(this.data.length)
    keep.forEach((k, j) => out.set(this.data.subarray(k * 4, k * 4 + 4), j * 4))
    this.data = out
    this.n = keep.length
  }
  reset() {
    this.n = 0
  }
}

export class PositionHistory {
  private tracks = new Map<string, Track>()

  /** Called for every accepted (newer) position. */
  add(hex: string, posTimeMs: number, lat: number, lon: number, alt: number | null, track: number | null) {
    if (alt == null) return
    const t = Math.round(posTimeMs / 1000) - BASE
    let tr = this.tracks.get(hex)
    if (!tr) this.tracks.set(hex, (tr = new Track()))
    if (tr.n) {
      const i = (tr.n - 1) * 4
      const lt = tr.data[i]
      const lalt = tr.data[i + 3]
      if (t <= lt) return
      // Long silence: whatever comes next is another flight.
      if (t - lt > NEW_FLIGHT_GAP_S) tr.reset()
      else if (alt === -1 && lalt === -1) {
        // Still on the ground: just move the single ground point (taxiing).
        tr.data[i] = t
        tr.data[i + 1] = Math.round(lat * 1e5)
        tr.data[i + 2] = Math.round(lon * 1e5)
        return
      } else if (alt === -1) {
        // Landed: the next flight starts here.
        tr.reset()
      } else {
        const turned = track != null && tr.lastTrack != null && Math.abs(((track - tr.lastTrack + 540) % 360) - 180) > 8
        const climbed = Math.abs(alt - lalt) > 1000 || lalt === -1
        if (!turned && !climbed && t - lt < MIN_GAP_S) return
      }
    }
    tr.push(t, lat, lon, alt)
    tr.lastTrack = track
  }

  /** Forget aircraft the store no longer has. */
  retain(has: (hex: string) => boolean) {
    for (const hex of this.tracks.keys()) if (!has(hex)) this.tracks.delete(hex)
  }

  /** The current flight as far as we've seen it, in the same shape as the adsb.lol path. */
  trace(hex: string): FlightTrace | null {
    const tr = this.tracks.get(hex)
    if (!tr || tr.n < 1) return null
    const points: [number, number, number, number][] = []
    for (let k = 0; k < tr.n; k++) {
      const i = k * 4
      points.push([(tr.data[i] + BASE) * 1000, tr.data[i + 1] / 1e5, tr.data[i + 2] / 1e5, tr.data[i + 3]])
    }
    const takeoff = points.length > 1 && points[0][3] === -1 ? points[1][0] : null
    return { hex, takeoff, points, partial: true, aircraft: null }
  }

  get size() {
    let pts = 0
    for (const t of this.tracks.values()) pts += t.n
    return { aircraft: this.tracks.size, points: pts }
  }
}
