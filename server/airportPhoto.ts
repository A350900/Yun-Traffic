import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AirportPhoto } from '../shared/wire.ts'
import { ensureMedia, mediaFile, mediaIndex } from './media.ts'

/**
 * Airport card photo, from Wikimedia Commons via server/media.ts: downloaded
 * once and served from this computer (works offline afterwards).
 */

const MAJOR: [string, string, string][] = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'major-airports.json'), 'utf8')).airports
export const AIRPORT_NAMES: Record<string, string> = Object.fromEntries(MAJOR.map((a) => [a[0], a[2]]))

function entry(icao: string): AirportPhoto {
  if (!mediaFile('airport-photos', icao)) return null
  const e = mediaIndex('airport-photos')[icao]
  return { src: `/api/media/airport-photos/${icao}`, link: e.link ?? '', author: e.author ?? 'Wikimedia Commons contributor', license: e.license ?? null }
}

export async function airportPhoto(icao: string): Promise<AirportPhoto> {
  const have = entry(icao)
  if (have) return have
  // Not downloaded yet: fetch it now (bounded wait; it keeps going in the background).
  await Promise.race([ensureMedia('airport-photos', { [icao]: AIRPORT_NAMES[icao] ?? icao }), new Promise((r) => setTimeout(r, 12_000))])
  return entry(icao)
}
