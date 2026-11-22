import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * North Atlantic Tracks (NAT OTS): published daily by Shanwick and Gander
 * (westbound tracks for the daytime flow, eastbound for the night), from the
 * FAA's public NAT track message page. Fetched at most every 30 minutes when
 * asked for, and the last good copy is kept in .cache/nat-tracks.json so the
 * map still has them offline (marked with when they were valid).
 *
 * Message format (one track):
 *   A ERAKA 61/20 62/30 63/40 63/50 SAVRY
 *   EAST LVLS NIL
 *   WEST LVLS 310 320 330 340 350 360 370 380 390
 * Points are lat/lon in whole degrees ("61/20" = 61N 20W) or with minutes
 * ("5530/20" = 55°30'N 20W); named fixes (ERAKA...) are the entry/exit points.
 */

const URL_NAT = 'https://www.notams.faa.gov/common/nat.html'
const UA = { 'User-Agent': 'yun-traffic/0.1 (+https://github.com/A350900/Yun-Traffic)' }
const CACHE = join(import.meta.dirname, '..', '.cache', 'nat-tracks.json')
const REFRESH_MS = 30 * 60_000

export interface NatTrack {
  id: string
  /** 'west' (daytime, Europe -> North America) or 'east' */
  dir: 'west' | 'east' | null
  /** [lon, lat] of the lat/lon points */
  points: [number, number][]
  /** named entry and exit fixes, if any */
  from: string | null
  to: string | null
  /** flight levels open, e.g. "310-390" */
  levels: string | null
}
export interface NatTracks {
  tracks: NatTrack[]
  /** validity as published, e.g. "NOV 22/1130Z TO NOV 22/1900Z" */
  valid: string[]
  tmi: string | null
  fetchedAt: number | null
  error?: string
}

const coord = /^(\d{2})(\d{2})?\/(\d{2,3})(\d{2})?$/

/** Parse the NAT track message text (HTML tags already removed). */
export function parseNat(text: string): Omit<NatTracks, 'fetchedAt'> {
  const lines = text.split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, ' '))
  const tracks: NatTrack[] = []
  const valid = new Set<string>()
  let tmi: string | null = null
  let cur: NatTrack | null = null
  for (const line of lines) {
    const v = line.match(/[A-Z]{3} \d{2}\/\d{4}Z TO [A-Z]{3} \d{2}\/\d{4}Z/)
    if (v) valid.add(v[0])
    const t = line.match(/TMI IS (\d+)/)
    if (t) tmi = t[1]
    const m = line.match(/^([A-Z]) ((?:[A-Z0-9/]+ ?)+)$/)
    if (m) {
      const tokens = m[2].split(' ')
      const points: [number, number][] = []
      for (const tok of tokens) {
        const c = tok.match(coord)
        if (c) points.push([-(+c[3] + (c[4] ? +c[4] / 60 : 0)), +c[1] + (c[2] ? +c[2] / 60 : 0)])
      }
      if (points.length >= 2) {
        cur = { id: m[1], dir: null, points, from: /^[A-Z]{5}$/.test(tokens[0]) ? tokens[0] : null, to: /^[A-Z]{5}$/.test(tokens[tokens.length - 1]) ? tokens[tokens.length - 1] : null, levels: null }
        tracks.push(cur)
        continue
      }
    }
    if (!cur) continue
    const lv = line.match(/^(EAST|WEST) LVLS (.+)$/)
    if (lv && lv[2] !== 'NIL') {
      cur.dir = lv[1] === 'EAST' ? 'east' : 'west'
      const fl = lv[2].split(' ').filter((x) => /^\d{3}$/.test(x))
      if (fl.length) cur.levels = fl.length > 1 ? `FL${fl[0]}–${fl[fl.length - 1]}` : `FL${fl[0]}`
    }
  }
  return { tracks, valid: [...valid], tmi }
}

let cache: NatTracks | null = null
try {
  cache = JSON.parse(readFileSync(CACHE, 'utf8'))
} catch {
  /* none yet */
}
let inflight: Promise<NatTracks> | null = null

export function natTracks(): Promise<NatTracks> {
  if (cache?.fetchedAt && Date.now() - cache.fetchedAt < REFRESH_MS) return Promise.resolve(cache)
  inflight ??= (async () => {
    try {
      const res = await fetch(URL_NAT, { headers: UA, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`FAA NAT page HTTP ${res.status}`)
      const text = (await res.text()).replace(/<[^>]*>/g, '\n').replace(/&nbsp;/g, ' ')
      const parsed = parseNat(text)
      if (!parsed.tracks.length) throw new Error('no tracks in the FAA message')
      cache = { ...parsed, fetchedAt: Date.now() }
      try {
        mkdirSync(join(CACHE, '..'), { recursive: true })
        writeFileSync(CACHE, JSON.stringify(cache))
      } catch {
        /* read-only disk */
      }
      return cache
    } catch (err) {
      // keep showing the last good tracks (offline / site down), saying why
      return { ...(cache ?? { tracks: [], valid: [], tmi: null, fetchedAt: null }), error: (err as Error).message }
    } finally {
      inflight = null
    }
  })()
  return inflight
}
