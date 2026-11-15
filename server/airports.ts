import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** ICAO → [IATA, name, city, country, lat, lon, time zone] (data/airports.json, from mwgg/Airports, MIT). */
export type AirportRow = [iata: string, name: string, city: string, country: string, lat: number, lon: number, tz: string]

export const AIRPORTS: Record<string, AirportRow> = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'data', 'airports.json'), 'utf8'),
)
