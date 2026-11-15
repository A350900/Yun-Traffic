import { F, Kind, type AircraftTuple } from '../shared/wire.ts'
import { AIRPORTS } from './airports.ts'
import type { FlightHistory, PastFlight } from './history.ts'
import type { AircraftStore } from './store.ts'
import { distanceKm, routeDestination } from './flightInfo.ts'

/**
 * Estimated aircraft ("ghosts") for where there's no live data:
 *
 * 1. Continued: a real, cruising aircraft that left receiver coverage keeps
 *    flying along the great circle to its destination at its last speed,
 *    until it should have landed or live data picks it up again.
 * 2. Simulated: yesterday's flights (OpenSky flight history) shifted +24 h,
 *    flown along the great circle between the two airports. Only shown where
 *    live coverage is thin (oceans, China, ...): in a well-covered area a
 *    missing live aircraft means the flight probably isn't operating today.
 *
 * Live data always wins: a real report of the same aircraft or callsign
 * replaces the ghost. Ghosts are recomputed every 30 s.
 */

const CYCLE_MS = 30_000
/**
 * A live aircraft with no new position for this long is considered out of
 * coverage: 6 min, or longer when the main source's snapshots are further
 * apart (anonymous OpenSky can be 8–14 min), so normal gaps aren't mistaken.
 */
const SILENT_MS = 6 * 60_000
/** After a (re)start, let live sources refresh before judging what's out of coverage. */
const STARTUP_GRACE_MS = 3 * 60_000
const MAX_CONTINUE_MS = 16 * 3600_000
/** Grid used to judge live coverage (degrees) and the "covered" threshold. */
const CELL_DEG = 2
const COVERED_MIN_AIRCRAFT = 3
const CRUISE_ALT_FT = 35_000

const R = Math.PI / 180

/** Point a fraction `f` of the way along the great circle from a to b. */
function along(lat1: number, lon1: number, lat2: number, lon2: number, f: number): [number, number] {
  const d = distanceKm(lat1, lon1, lat2, lon2) / 6371
  if (d < 1e-6) return [lat1, lon1]
  const A = Math.sin((1 - f) * d) / Math.sin(d)
  const B = Math.sin(f * d) / Math.sin(d)
  const x = A * Math.cos(lat1 * R) * Math.cos(lon1 * R) + B * Math.cos(lat2 * R) * Math.cos(lon2 * R)
  const y = A * Math.cos(lat1 * R) * Math.sin(lon1 * R) + B * Math.cos(lat2 * R) * Math.sin(lon2 * R)
  const z = A * Math.sin(lat1 * R) + B * Math.sin(lat2 * R)
  return [Math.atan2(z, Math.hypot(x, y)) / R, Math.atan2(y, x) / R]
}

/** Initial compass bearing from a to b, degrees. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const y = Math.sin((lon2 - lon1) * R) * Math.cos(lat2 * R)
  const x = Math.cos(lat1 * R) * Math.sin(lat2 * R) - Math.sin(lat1 * R) * Math.cos(lat2 * R) * Math.cos((lon2 - lon1) * R)
  return (Math.atan2(y, x) / R + 360) % 360
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

interface Continued {
  base: AircraftTuple
  lat: number
  lon: number
  /** epoch ms of the last real position */
  since: number
  gsKt: number
  dest: { icao: string; lat: number; lon: number }
}

export interface GhostDetails {
  kind: 'continued' | 'simulated'
  callsign: string | null
  /** Continued: when the last real position was received */
  lastSeen?: number
  destination?: string
  /** Simulated: yesterday's flight it's based on */
  flight?: PastFlight
}

export class GhostManager {
  private continued = new Map<string, Continued>()
  private simulated = new Map<string, PastFlight>()
  private pendingLookups = new Set<string>()
  status = { continued: 0, simulated: 0 }
  /** Why silent aircraft were or weren't continued (last cycle), for /api/health. */
  debug = { silent: 0, notCruising: 0, noDestination: 0, lookupsPending: 0, rejected: 0, started: 0 }
  private store: AircraftStore
  private history: FlightHistory

  constructor(store: AircraftStore, history: FlightHistory) {
    this.store = store
    this.history = history
  }

  private startedAt = Date.now()

  start() {
    this.startedAt = Date.now()
    setInterval(() => this.cycle(), CYCLE_MS)
    setTimeout(() => this.cycle(), 5000)
  }

  details(id: string): GhostDetails | null {
    const c = this.continued.get(id)
    if (c) return { kind: 'continued', callsign: c.base[F.Callsign], lastSeen: c.since, destination: c.dest.icao }
    const s = this.simulated.get(id)
    if (s) return { kind: 'simulated', callsign: s.callsign, flight: s }
    return null
  }

  private cycle() {
    const now = Date.now()
    this.continueSilentAircraft()
    this.moveContinued(now)
    this.updateSimulated(now)
    this.status = { continued: this.continued.size, simulated: this.simulated.size }
  }

  // ------------------------------------------------------------ 1. continued

  private continueSilentAircraft() {
    const d = { silent: 0, notCruising: 0, noDestination: 0, lookupsPending: this.pendingLookups.size, rejected: this.debug.rejected, started: this.debug.started }
    this.debug = d
    if (Date.now() - this.startedAt < STARTUP_GRACE_MS) return
    const staleAfter = Math.max(SILENT_MS, this.store.reportIntervalMs * 1.2 + 60_000)
    for (const ac of this.store.stalePositions(staleAfter)) {
      const hex = ac[F.Hex]
      const cs = ac[F.Callsign]
      if (this.continued.has(hex) || !cs) continue
      d.silent++
      // Only cruising aircraft: low/slow ones are probably landing or local.
      if ((ac[F.Alt] ?? 0) < 20_000 || (ac[F.Gs] ?? 0) < 250 || ac[F.Track] == null) {
        d.notCruising++
        continue
      }

      // Destination: where this callsign went yesterday, else the route database.
      const past = this.history.lastFlight(cs)
      const known = past ? AIRPORTS[past.arr] : undefined
      if (known) {
        this.tryContinue(ac, { icao: past!.arr, lat: known[4], lon: known[5] })
      } else if (!this.pendingLookups.has(cs) && this.pendingLookups.size < 20) {
        d.noDestination++
        this.pendingLookups.add(cs)
        void routeDestination(cs)
          .then((d) => {
            const latest = this.store.get(hex)
            if (d && latest && !latest[F.Kind]) this.tryContinue(latest, { icao: d.icao, lat: d.lat, lon: d.lon })
          })
          .finally(() => this.pendingLookups.delete(cs))
      }
    }
  }

  private tryContinue(ac: AircraftTuple, dest: Continued['dest']) {
    const remaining = distanceKm(ac[F.Lat], ac[F.Lon], dest.lat, dest.lon)
    // Nearly there (it'll just land), or the destination isn't roughly ahead (wrong route).
    if (remaining < 150 || angleDiff(bearing(ac[F.Lat], ac[F.Lon], dest.lat, dest.lon), ac[F.Track]!) > 70) {
      this.debug.rejected++
      return
    }
    this.debug.started++
    this.continued.set(ac[F.Hex], {
      base: ac,
      lat: ac[F.Lat],
      lon: ac[F.Lon],
      since: ac[F.PosTime],
      gsKt: ac[F.Gs]!,
      dest,
    })
  }

  private moveContinued(now: number) {
    for (const [hex, c] of this.continued) {
      const current = this.store.get(hex)
      // Dropped meanwhile, or a newer real position arrived: stop estimating.
      if (!current || (!current[F.Kind] && current[F.PosTime] > c.since)) {
        this.continued.delete(hex)
        continue
      }
      const total = distanceKm(c.lat, c.lon, c.dest.lat, c.dest.lon)
      const flown = (c.gsKt * 1.852 * (now - c.since)) / 3_600_000
      if (flown >= total - 30 || now - c.since > MAX_CONTINUE_MS) {
        // Should have landed by now.
        this.continued.delete(hex)
        this.store.remove(hex)
        continue
      }
      const [lat, lon] = along(c.lat, c.lon, c.dest.lat, c.dest.lon, flown / total)
      const t: AircraftTuple = [...c.base] as AircraftTuple
      t[F.Lat] = Math.round(lat * 1e5) / 1e5
      t[F.Lon] = Math.round(lon * 1e5) / 1e5
      t[F.Track] = Math.round(bearing(lat, lon, c.dest.lat, c.dest.lon))
      t[F.PosTime] = now
      t[F.VRate] = 0
      t[F.Kind] = Kind.Continued
      if (!this.store.upsertGhost(t, c.since)) this.continued.delete(hex) // live again
    }
  }

  // ------------------------------------------------------------ 2. simulated

  private updateSimulated(now: number) {
    const live = this.store.ofKind(Kind.Live)
    const continued = this.store.ofKind(Kind.Continued)
    const callsigns = new Set<string>()
    const addresses = new Set<string>()
    const coverage = new Map<string, number>()
    const cell = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)},${Math.floor(lon / CELL_DEG)}`
    for (const ac of live) {
      if (ac[F.Callsign]) callsigns.add(ac[F.Callsign]!)
      addresses.add(ac[F.Hex])
      // Coverage = recent real positions.
      if (now - ac[F.PosTime] < 5 * 60_000) coverage.set(cell(ac[F.Lat], ac[F.Lon]), (coverage.get(cell(ac[F.Lat], ac[F.Lon])) ?? 0) + 1)
    }
    for (const ac of continued) if (ac[F.Callsign]) callsigns.add(ac[F.Callsign]!)

    const nowS = now / 1000
    const keep = new Set<string>()
    for (const f of this.history.airborneYesterdayAt(nowS)) {
      // The real flight (or aircraft) is live, or already being continued.
      if (callsigns.has(f.callsign) || addresses.has(f.icao24)) continue
      const a = AIRPORTS[f.dep]
      const b = AIRPORTS[f.arr]
      const duration = f.lastSeen - f.firstSeen
      const frac = Math.min(1, Math.max(0, (nowS - 86_400 - f.firstSeen) / duration))
      const [lat, lon] = along(a[4], a[5], b[4], b[5], frac)
      // Well-covered area but no live match: probably not flying today.
      if ((coverage.get(cell(lat, lon)) ?? 0) >= COVERED_MIN_AIRCRAFT) continue

      const id = `s${f.icao24}`
      if (keep.has(id)) continue
      keep.add(id)
      this.simulated.set(id, f)
      const distKm = distanceKm(a[4], a[5], b[4], b[5])
      const minutesIn = (frac * duration) / 60
      const minutesLeft = ((1 - frac) * duration) / 60
      // A simple profile: climb for the first 20 min, descend for the last 25.
      const alt = Math.round(Math.min(CRUISE_ALT_FT, minutesIn * 1750, minutesLeft * 1400) / 100) * 100
      this.store.upsertGhost([
        id,
        Math.round(lat * 1e5) / 1e5,
        Math.round(lon * 1e5) / 1e5,
        Math.round(bearing(lat, lon, b[4], b[5])),
        Math.round(distKm / 1.852 / (duration / 3600)),
        Math.max(alt, 1000),
        f.callsign,
        null,
        null,
        now,
        null,
        null,
        0,
        Kind.Simulated,
      ])
    }
    for (const id of this.simulated.keys()) {
      if (!keep.has(id)) {
        this.simulated.delete(id)
        this.store.remove(id)
      }
    }
  }
}
