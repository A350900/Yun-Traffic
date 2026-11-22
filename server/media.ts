import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Images from Wikimedia Commons, downloaded once and kept on this computer so
 * the app works offline: airline logos (Encyclopedia mode) and airport photos
 * (airport card).
 *
 * Found through Wikidata: an airline by its ICAO code (property P230), with its
 * full logo (P154, shown in the expanded card) and its icon (P8972, a square
 * emblem for the round badges); an airport by its ICAO code (P239) and its main
 * image (P18).
 * Commons gives a 256/640 px version plus the author and license to credit.
 *
 * Wikimedia asks automated clients to keep requests low: lookups are batched
 * (~25 codes a request), downloads go one at a time, and a "too many requests"
 * answer pauses everything for a while. Files: .cache/media/<kind>/<ICAO>.<ext>,
 * index: .cache/media/<kind>.json.
 *
 * Your own images win. Airline logos: put a file named by the airline's ICAO
 * code in logos/ at the top of the project (e.g. logos/CES.png; any case,
 * .png/.svg/.jpg/.jpeg/.webp). Also read: custom-media/<kind>/<CODE>.<ext>.
 * Useful where Commons has no free version (detailed logos are often
 * copyrighted, so they aren't on Commons). These folders aren't uploaded to GitHub.
 */

const UA = { 'User-Agent': 'yun-traffic/0.1 (+https://github.com/A350900/Yun-Traffic)' }
const ROOT = join(import.meta.dirname, '..', '.cache', 'media')
const CUSTOM = join(import.meta.dirname, '..', 'custom-media')
/** the simple folder for your own airline logos: logos/CES.png */
const LOGOS = join(import.meta.dirname, '..', 'logos')
const EXTS = ['png', 'svg', 'jpg', 'jpeg', 'webp']
const DAY = 86_400_000

export type MediaKind = 'airline-logos' | 'airline-icons' | 'airport-photos'
const SPEC: Record<MediaKind, { codeProp: string; imageProps: string[]; width: number }> = {
  'airline-logos': { codeProp: 'P230', imageProps: ['P154'], width: 320 },
  'airline-icons': { codeProp: 'P230', imageProps: ['P8972'], width: 160 },
  'airport-photos': { codeProp: 'P239', imageProps: ['P18'], width: 640 },
}

export interface MediaEntry {
  /** file name in .cache/media/<kind>/ (absent: no image found) */
  file?: string
  /** Wikidata label (to check it's the right airline/airport) */
  label?: string
  author?: string
  license?: string | null
  /** Commons page for the credit link */
  link?: string
  /** when this was looked up */
  at: number
  /** why there's no image */
  reason?: string
  /** lookup version (older entries are looked up again; see VERSION) */
  v?: number
}

/** Bump to look everything up again (3: full logos and icons kept separately). */
const VERSION: Record<MediaKind, number> = { 'airline-logos': 3, 'airline-icons': 1, 'airport-photos': 1 }

class RateLimited extends Error {}
let pausedUntil = 0

async function get(url: string): Promise<Response> {
  if (Date.now() < pausedUntil) throw new RateLimited('waiting after "too many requests"')
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) })
  if (res.status === 429) {
    pausedUntil = Date.now() + 15 * 60_000
    throw new RateLimited('Wikimedia: too many requests')
  }
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`)
  return res
}
const getJson = async (url: string) => (await get(url)).json() as Promise<any>
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

const NOISE = new Set(['airlines', 'airline', 'airways', 'aviation', 'aviacion', 'lineas', 'aereas', 'the', 'and', 'international', 'airport', 'linhas', 'company', 'limited'])
const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w))

/**
 * How well a Wikidata label matches our name: 0 = not the same, otherwise
 * higher is better. All words of the shorter name must appear in the other
 * ("KLM" ~ "KLM Royal Dutch Airlines"); ties go to the closer match, so
 * "Japan Airlines" picks Japan Airlines over Japan Air System.
 */
export function nameMatch(ours: string, theirs: string) {
  const a = new Set(words(ours))
  const b = new Set(words(theirs))
  if (!a.size || !b.size) return ours.trim().toLowerCase() === theirs.trim().toLowerCase() ? 1 : 0
  const shared = [...a].filter((w) => b.has(w)).length
  if (shared < Math.min(a.size, b.size)) return 0
  return shared / (a.size + b.size - shared) // Jaccard: 1 = same words
}
export const sameName = (ours: string, theirs: string) => nameMatch(ours, theirs) > 0

/** Commons file names compare with underscores as spaces and a capital first letter. */
const fileKey = (f: string) => {
  const s = f.replace(/^File:/, '').replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type Found = { file: string; label: string }
type Miss = { reason: string }

/** ICAO codes -> Wikidata image file names (batched). `names` are ours, to pick the right item. */
async function findImages(kind: MediaKind, codes: string[], names: Record<string, string>): Promise<Record<string, Found | Miss>> {
  const { codeProp, imageProps } = SPEC[kind]
  const wd = 'https://www.wikidata.org/w/api.php?format=json&'
  const out: Record<string, Found | Miss> = Object.fromEntries(codes.map((c) => [c, { reason: 'not found on Wikidata by its ICAO code' }]))
  const best: Record<string, number> = {}
  for (let i = 0; i < codes.length; i += 25) {
    const batch = codes.slice(i, i + 25)
    const q = batch.map((c) => `${codeProp}=${c}`).join('|')
    const search = await getJson(`${wd}action=query&list=search&srlimit=100&srsearch=${encodeURIComponent(`haswbstatement:${q}`)}`)
    const ids: string[] = (search?.query?.search ?? []).map((r: { title: string }) => r.title)
    await pause(1000)
    for (let j = 0; j < ids.length; j += 50) {
      const ents = await getJson(`${wd}action=wbgetentities&props=claims|labels&languages=en&ids=${ids.slice(j, j + 50).join('|')}`)
      await pause(1000)
      for (const e of Object.values(ents?.entities ?? {}) as any[]) {
        const label: string = e?.labels?.en?.value ?? ''
        // first property that has an image (airlines: icon before full logo)
        const file: string | undefined = imageProps.map((p) => e?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value).find(Boolean)
        for (const c of e?.claims?.[codeProp] ?? []) {
          const code = String(c?.mainsnak?.datavalue?.value ?? '').toUpperCase()
          if (!(code in out)) continue
          // Codes get reused (defunct airlines): take the item whose name matches ours best.
          const score = kind !== 'airport-photos' ? nameMatch(names[code] ?? '', label) : 1
          const cur = out[code]
          if (!file) {
            if ('reason' in cur && score > 0) out[code] = { reason: `no free ${kind === 'airline-logos' ? 'logo' : kind === 'airline-icons' ? 'icon' : 'photo'} on Wikimedia Commons (Wikidata: ${label})` }
            continue
          }
          if (score === 0) {
            if ('reason' in cur && cur.reason.startsWith('not found')) out[code] = { reason: `name didn't match (Wikidata has "${label}" for this code)` }
            continue
          }
          if (score > (best[code] ?? 0)) {
            best[code] = score
            out[code] = { file, label }
          }
        }
      }
    }
  }
  return out
}

/** Commons file names -> thumbnail URL + credit (batched). */
async function commonsInfo(files: string[], width: number) {
  const info: Record<string, { url: string; link: string; author: string; license: string | null }> = {}
  for (let i = 0; i < files.length; i += 40) {
    const titles = files.slice(i, i + 40).map((f) => `File:${f}`)
    const res = await getJson(
      `https://commons.wikimedia.org/w/api.php?format=json&action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${width}&titles=${encodeURIComponent(titles.join('|'))}`,
    )
    await pause(1000)
    for (const page of Object.values(res?.query?.pages ?? {}) as any[]) {
      const ii = page?.imageinfo?.[0]
      if (!ii) continue
      const asked = fileKey(page.title)
      const meta = ii.extmetadata ?? {}
      info[asked] = {
        url: ii.thumburl ?? ii.url,
        link: ii.descriptionurl,
        author: plainText(meta.Artist?.value) || 'Wikimedia Commons contributor',
        license: plainText(meta.LicenseShortName?.value) || null,
      }
    }
  }
  return info
}

// ---------------------------------------------------------------- the store on disk

const indexes = new Map<MediaKind, Record<string, MediaEntry>>()
const indexFile = (kind: MediaKind) => join(ROOT, `${kind}.json`)
const dir = (kind: MediaKind) => join(ROOT, kind)

export function mediaIndex(kind: MediaKind): Record<string, MediaEntry> {
  let idx = indexes.get(kind)
  if (!idx) {
    try {
      idx = JSON.parse(readFileSync(indexFile(kind), 'utf8'))
    } catch {
      idx = {}
    }
    indexes.set(kind, idx!)
  }
  return idx!
}
function saveIndex(kind: MediaKind) {
  mkdirSync(ROOT, { recursive: true })
  writeFileSync(indexFile(kind), JSON.stringify(mediaIndex(kind)))
}

/** A file named <code>.<ext> in a folder, any letter case. */
function findIn(dir: string, code: string): string | null {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  const want = code.toUpperCase()
  for (const n of names) {
    const dot = n.lastIndexOf('.')
    if (dot > 0 && n.slice(0, dot).toUpperCase() === want && EXTS.includes(n.slice(dot + 1).toLowerCase())) return join(dir, n)
  }
  return null
}

/** Your own image for this code: logos/<CODE>.<ext> (airline logos), else custom-media/<kind>/. */
export function customFile(kind: MediaKind, code: string): string | null {
  return (kind === 'airline-logos' ? findIn(LOGOS, code) : null) ?? findIn(join(CUSTOM, kind), code)
}

/** Path of the image to use: your own, else the downloaded one. */
export function mediaFile(kind: MediaKind, code: string): string | null {
  const custom = customFile(kind, code)
  if (custom) return custom
  const e = mediaIndex(kind)[code]
  return e?.file && existsSync(join(dir(kind), e.file)) ? join(dir(kind), e.file) : null
}

/** Looked up recently enough (found, or not found within the last week). */
function fresh(e: MediaEntry | undefined, kind: MediaKind, code: string) {
  if (!e || (e.v ?? 1) < VERSION[kind]) return false
  if (e.file) return mediaFile(kind, code) !== null
  return Date.now() - e.at < 7 * DAY
}

let running: Promise<void> | null = null
const queued = new Map<MediaKind, Record<string, string>>()

/**
 * Make sure we have images for these codes (code -> our name). Runs in the
 * background, one batch job at a time; safe to call often.
 */
export function ensureMedia(kind: MediaKind, wanted: Record<string, string>): Promise<void> {
  const q = queued.get(kind) ?? {}
  for (const [code, name] of Object.entries(wanted)) if (!customFile(kind, code) && !fresh(mediaIndex(kind)[code], kind, code)) q[code] = name
  queued.set(kind, q)
  running ??= (async () => {
    try {
      for (const [k, items] of [...queued]) {
        queued.delete(k)
        if (Object.keys(items).length) await download(k, items)
      }
    } catch (err) {
      console.warn(`[media] ${(err as Error).message}${err instanceof RateLimited ? ' — will try again later' : ''}`)
    } finally {
      running = null
    }
  })()
  return running
}

async function download(kind: MediaKind, items: Record<string, string>) {
  const codes = Object.keys(items)
  console.log(`[media] looking up ${codes.length} ${kind} on Wikimedia`)
  const found = await findImages(kind, codes, items)
  const files = [...new Set(Object.values(found).filter((f): f is Found => 'file' in f).map((f) => f.file))]
  const info = await commonsInfo(files, SPEC[kind].width)
  mkdirSync(dir(kind), { recursive: true })
  const idx = mediaIndex(kind)
  let got = 0
  for (const code of codes) {
    const f = found[code]
    const i = 'file' in f ? info[fileKey(f.file)] : undefined
    if (!('file' in f) || !i) {
      idx[code] = { at: Date.now(), v: VERSION[kind], reason: 'reason' in f ? f.reason : 'file not found on Wikimedia Commons' }
      continue
    }
    const res = await get(i.url)
    const type = res.headers.get('content-type') ?? ''
    const ext = type.includes('png') ? 'png' : type.includes('svg') ? 'svg' : type.includes('webp') ? 'webp' : 'jpg'
    const file = `${code}.${ext}`
    writeFileSync(join(dir(kind), file), Buffer.from(await res.arrayBuffer()))
    idx[code] = { file, label: f.label, author: i.author, license: i.license, link: i.link, at: Date.now(), v: VERSION[kind] }
    got++
    saveIndex(kind)
    await pause(400)
  }
  saveIndex(kind)
  console.log(`[media] ${kind}: ${got} downloaded, ${codes.length - got} not on Wikimedia`)
}
