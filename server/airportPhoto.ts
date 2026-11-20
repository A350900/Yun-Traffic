import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AirportPhoto } from '../shared/wire.ts'

/**
 * A photo for an airport card, from Wikimedia Commons: the airport's Wikidata
 * item (found by its ICAO code, property P239) names its main image (P18), and
 * Commons gives a 640 px version plus the author and license to credit.
 *
 * Wikimedia asks automated clients to keep requests low, so each airport is
 * looked up once, one at a time, and the answer is saved to
 * .cache/airport-photos.json (re-checked after 30 days, or a day after a miss).
 */

const UA = { 'User-Agent': 'yun-traffic/0.1 (+https://github.com/A350900/Yun-Traffic)' }
const CACHE_DIR = join(import.meta.dirname, '..', '.cache')
const CACHE_FILE = join(CACHE_DIR, 'airport-photos.json')
const DAY = 86_400_000

type Entry = { photo: AirportPhoto; at: number }
let cache: Record<string, Entry> = {}
try {
  cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
} catch {
  /* first run */
}
function save() {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch {
    /* read-only disk: just won't persist */
  }
}

async function getJson(url: string) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`)
  return res.json()
}

/** Plain text from Commons' HTML author field ("<a href=…>Jane Doe</a>" → "Jane Doe"). */
export function plainText(html: string | undefined) {
  return (html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function lookupAirportPhoto(icao: string, get: (url: string) => Promise<any> = getJson): Promise<AirportPhoto> {
  const wd = 'https://www.wikidata.org/w/api.php?format=json&'
  const search = await get(`${wd}action=query&list=search&srlimit=1&srsearch=${encodeURIComponent(`haswbstatement:P239=${icao}`)}`)
  const qid: string | undefined = search?.query?.search?.[0]?.title
  if (!qid) return null
  const entity = await get(`${wd}action=wbgetentities&props=claims&ids=${qid}`)
  const file: string | undefined = entity?.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
  if (!file) return null
  const info = await get(
    `https://commons.wikimedia.org/w/api.php?format=json&action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640&titles=${encodeURIComponent(`File:${file}`)}`,
  )
  const page = Object.values(info?.query?.pages ?? {})[0] as { imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[] } | undefined
  const ii = page?.imageinfo?.[0]
  if (!ii) return null
  const meta = ii.extmetadata ?? {}
  return {
    src: ii.thumburl ?? ii.url!,
    link: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
    author: plainText(meta.Artist?.value) || 'Wikimedia Commons contributor',
    license: plainText(meta.LicenseShortName?.value) || null,
  }
}

// One lookup at a time (and the same airport only once at a time).
let queue: Promise<unknown> = Promise.resolve()
const pending = new Map<string, Promise<AirportPhoto>>()

export function airportPhoto(icao: string): Promise<AirportPhoto> {
  const hit = cache[icao]
  if (hit && Date.now() - hit.at < (hit.photo ? 30 * DAY : DAY)) return Promise.resolve(hit.photo)
  let p = pending.get(icao)
  if (!p) {
    const run = queue.catch(() => {}).then(() => lookupAirportPhoto(icao))
    queue = run
    p = run
      .then((photo) => {
        cache[icao] = { photo, at: Date.now() }
        save()
        return photo
      })
      .catch(() => hit?.photo ?? null) // Wikimedia unreachable: keep any older answer, don't cache the miss
      .finally(() => pending.delete(icao)) as Promise<AirportPhoto>
    pending.set(icao, p)
  }
  return p
}
