// Simulated traffic: every adjustable setting in one place.
// Edit these and the change shows up on the map (no other code changes needed).

export const SIM_CONFIG = {
  // ---------------------------------------------------------------- display
  /** Never show simulated aircraft closer than this to their departure/arrival airport (nm). */
  hideWithinNm: 40,
  /** ...and fade them in until this distance (nm). Beyond it they're fully visible. */
  fadeUntilNm: 100,
  /** Overall opacity of simulated aircraft (live ones are 1). */
  opacity: 0.75,

  // ---------------------------------------------------------------- where to simulate
  /**
   * A 2° cell is "covered" (never simulated) if, at its best measured hour, live data sees at
   * least this share of the traffic the model expects there. Receivers don't move, so a cell
   * covered at one hour is treated as covered at all hours.
   */
  coveredRatio: 0.6,
  /** Below this share the cell is a "gap" (filled fully); in between it's "partial" (difference only). */
  gapRatio: 0.2,
  /**
   * Safety net: a cell where live aircraft are seen in at least this share of samples counts as
   * covered unless it's clearly a gap (below gapRatio). Keeps the US/Europe free of simulated
   * traffic even when the model's hourly estimate is off.
   */
  alwaysSeen: 0.9,
  /** Hours where the model expects fewer aircraft than this in a cell aren't used to judge it. */
  minExpected: 1,

  // ---------------------------------------------------------------- schedule model
  /**
   * Daily flights on a route ~ scale x (airport A size x airport B size)^sizeExponent / distance factor.
   * Airport "size" = number of routes it has in the route data. Higher exponent = busier trunk routes
   * relative to small ones.
   */
  sizeExponent: 0.75,
  /** Distance factor = 1 + km / distanceSoftenKm (longer routes have fewer daily flights). */
  distanceSoftenKm: 2500,
  /** No route gets more than this many flights a day (per airline). */
  maxDailyPerRoute: 24,
  /**
   * Overall size of the schedule before calibration. The real value comes from
   * data/sim/calibration.json (scripts/sim/calibrate.ts): regions matched to published daily
   * flights, then the global airborne count to ~14,900 at the July 14:15 UTC peak (Eurocontrol).
   */
  defaultScale: 0.0013,
  /** Routes shorter than this are left out (mostly island hops and circuits). */
  minRouteKm: 120,

  // ---------------------------------------------------------------- aircraft performance
  /** Cruise ground speed (km/h) and altitude (ft) by size class; minutes added for taxi/climb/descent. */
  classes: {
    turboprop: { speedKmh: 500, altitudeFt: 22000, overheadMin: 20 },
    regional: { speedKmh: 700, altitudeFt: 33000, overheadMin: 25 },
    narrowbody: { speedKmh: 800, altitudeFt: 35000, overheadMin: 30 },
    widebody: { speedKmh: 870, altitudeFt: 37000, overheadMin: 35 },
  },

  /** Seed for the deterministic daily schedule (change to get a different but equally valid sky). */
  seed: 'yun-traffic',
} as const

export type SizeClass = keyof typeof SIM_CONFIG.classes
