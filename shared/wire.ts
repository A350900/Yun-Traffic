// Wire format shared by the server and the browser.
// Aircraft are sent as compact tuples instead of objects: at 10k+ aircraft
// this cuts the payload roughly in half and makes parsing cheaper.

/** Index of each field inside an AircraftTuple. */
export const F = {
  Hex: 0,
  Lat: 1,
  Lon: 2,
  /** Track over ground, degrees true (null if unknown) */
  Track: 3,
  /** Ground speed, knots */
  Gs: 4,
  /** Barometric altitude, feet. -1 = on ground, null = unknown */
  Alt: 5,
  Callsign: 6,
  /** ICAO type designator, e.g. A20N */
  Type: 7,
  Registration: 8,
  /** Epoch ms when this position was received by the network */
  PosTime: 9,
  Squawk: 10,
  /** ADS-B emitter category, e.g. A3 */
  Category: 11,
  /** Vertical rate, ft/min */
  VRate: 12,
} as const

export type AircraftTuple = [
  hex: string,
  lat: number,
  lon: number,
  track: number | null,
  gs: number | null,
  alt: number | null,
  callsign: string | null,
  type: string | null,
  registration: string | null,
  posTime: number,
  squawk: string | null,
  category: string | null,
  vrate: number | null,
]

export interface AircraftResponse {
  /** Version to pass back as `since` on the next request */
  version: number
  /** Server clock (epoch ms) when the response was built */
  now: number
  /** true when this is a full snapshot rather than a delta */
  full: boolean
  aircraft: AircraftTuple[]
  /** Hex codes removed since `since` */
  removed: string[]
  stats: FeedStats
}

export interface FeedStats {
  total: number
  /** Epoch ms of the most recent successful upstream fetch */
  lastFetch: number | null
  /** How long a full sweep of all aircraft types takes at the current pacing, seconds */
  sweepSeconds: number
  rateLimited: boolean
  /** Secondary region-sweep source */
  airplanesLive?: { lastFetch: number | null; error: string | null }
  opensky?: {
    enabled: boolean
    /** Using the owner's OpenSky account (vs anonymous, much lower limits) */
    authenticated: boolean
    lastFetch: number | null
    nextFetch: number | null
    error: string | null
  }
}

// ---------------------------------------------------------------- flight details

export interface AirportInfo {
  icao: string
  iata: string | null
  name: string
  city: string
  country: string
  lat: number
  lon: number
  /** IANA time zone, e.g. America/New_York */
  tz: string | null
}

export interface FlightInfo {
  hex: string
  callsign: string | null
  airline: { name: string; icao: string; iata: string | null } | null
  aircraft: { typeCode: string | null; name: string | null; registration: string | null; owner: string | null }
  /**
   * `plausible`: false when the aircraft's position doesn't fit the route (stale database entry).
   * `verified`: the departure airport was checked against where the aircraft actually took off.
   * `reversed`: the database had this flight number the other way round (the return leg); swapped to match the aircraft's heading.
   */
  route: { origin: AirportInfo; destination: AirportInfo; plausible: boolean; originCorrected: boolean; verified: boolean; reversed?: boolean } | null
}

/** planespotters.net photo (GET /api/photo/:hex); must be shown with the photographer credit and link */
export type FlightPhoto = { src: string; link: string; photographer: string } | null

export interface FlightTrace {
  hex: string
  /** Epoch ms of takeoff, if seen */
  takeoff: number | null
  /** [epoch ms, lat, lon, altitude ft (-1 = on ground)] */
  points: [number, number, number, number][]
  /** true when the full history couldn't be fetched (only recent points) */
  partial?: boolean
  /** Aircraft details that come with the trace (fallback for the details panel) */
  aircraft?: { type: string | null; registration: string | null; desc: string | null } | null
}
