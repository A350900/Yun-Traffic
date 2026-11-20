// Simulated traffic: shapes of the data files (data/sim/*.json, data/airports.json).

/** ICAO -> [IATA, name, city, country (ISO), lat, lon, time zone] */
export type AirportRow = [string, string, string, string, number, number, string]
export type Airports = Record<string, AirportRow>

export interface RoutesFile {
  /** [icao, iata, name, country] */
  airlines: [string, string, string, string][]
  /** [airline index, departure ICAO, arrival ICAO, "ICAO type codes"] */
  routes: [number, string, string, string][]
  /** ICAO type -> model name */
  aircraft: Record<string, string>
}

export interface TrafficModel {
  globalAirborne: { julyPeak: { value: number }; novemberTrough: { value: number } }
  regionalDailyFlights: Record<string, { countries?: string[]; flights: number }>
  corridorDailyFlights?: Record<string, { flights: number } | string>
  pairDailyFlights?: Record<string, { flights: number } | string>
  monthly: Record<string, { factors: number[] }>
  weekday: { factors: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', number> }
  departureProfiles: {
    shortHaul: number[]
    longHaul: number[]
    longHaulFromKm: number
    banks: Record<string, { hours: number[] | number[][]; floor?: number; airports?: string[] }>
  }
}

/** Written by scripts/sim/calibrate.ts (data/sim/calibration.json). */
export interface Calibration {
  scale: number
  /** overrides SIM_CONFIG.distanceSoftenKm */
  distanceSoftenKm?: number
  /** departure country (ISO) -> multiplier */
  countryMultipliers: Record<string, number>
  /** ocean corridor (see corridorOf in schedule.ts) -> multiplier */
  corridorMultipliers?: Record<string, number>
  /** country pair ("CN-US", alphabetical) -> multiplier */
  pairMultipliers?: Record<string, number>
}

/** Freighter routes (data/sim/cargo-routes.json): flown both ways, `daily` flights each way. */
export interface CargoFile {
  airlines: [string, string, string, string][]
  aircraft: Record<string, string>
  /** [airline ICAO, airport ICAO, airport ICAO, "ICAO type codes", daily flights each way] */
  routes: [string, string, string, string, number][]
}

export interface SimData {
  routes: RoutesFile
  airports: Airports
  model: TrafficModel
  calibration?: Calibration
  cargo?: CargoFile
}
