#!/usr/bin/env node
// Builds data/sim/routes.json for the simulated-traffic feature from the
// OpenFlights databases (routes frozen in June 2014; ODbL licence).
//
//   node scripts/sim/build-routes.mjs [--live http://localhost:8787]
//
// Steps: download OpenFlights data -> keep direct, non-codeshare routes
// between airports we know (data/airports.json) -> drop/merge airlines that
// no longer fly (data/sim/airline-fixes.json), always keeping airlines seen
// flying in live data -> map aircraft codes to ICAO type designators.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'data', 'sim', 'routes.json')
const SEEN_FILE = join(ROOT, 'data', 'sim', 'airlines-seen.json')
const BASE = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data'
const args = process.argv.slice(2)
const liveUrl = args.includes('--live') ? args[args.indexOf('--live') + 1] : null

/** Minimal CSV line parser for the OpenFlights .dat files (quoted fields, \N = null). */
function parseLine(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((v) => (v === '\\N' ? '' : v))
}

async function download(name) {
  const res = await fetch(`${BASE}/${name}.dat`)
  if (!res.ok) throw new Error(`${name}.dat: HTTP ${res.status}`)
  return (await res.text()).split('\n').filter(Boolean).map(parseLine)
}

// --- our airports (ICAO -> [iata, name, city, country, lat, lon, tz])
const AIRPORTS = JSON.parse(readFileSync(join(ROOT, 'data', 'airports.json'), 'utf8'))
const byIata = new Map(Object.entries(AIRPORTS).map(([icao, a]) => [a[0], icao]))
const toIcao = (code) => (code.length === 4 && AIRPORTS[code] ? code : byIata.get(code) ?? null)

const fixes = JSON.parse(readFileSync(join(ROOT, 'data', 'sim', 'airline-fixes.json'), 'utf8'))

// --- airlines seen flying in live data (callsign prefixes): earlier builds,
//     the server's recorder (.cache/sim/recorder.json) and optionally --live
const seen = new Set(existsSync(SEEN_FILE) ? JSON.parse(readFileSync(SEEN_FILE, 'utf8')).airlines : [])
const RECORDER = join(ROOT, '.cache', 'sim', 'recorder.json')
if (existsSync(RECORDER)) for (const p of Object.keys(JSON.parse(readFileSync(RECORDER, 'utf8')).airlines ?? {})) seen.add(p)
{
  if (liveUrl) {
    const body = await (await fetch(`${liveUrl}/api/aircraft`)).json()
    for (const ac of body.aircraft) {
      const m = ac[6]?.match(/^([A-Z]{3})\d/)
      if (m) seen.add(m[1])
    }
  }
  writeFileSync(SEEN_FILE, JSON.stringify({ updated: new Date().toISOString(), airlines: [...seen].sort() }, null, 0) + '\n')
}

console.log('Downloading OpenFlights data…')
const [airlinesRaw, routesRaw, planesRaw, airportsRaw] = await Promise.all([download('airlines'), download('routes'), download('planes'), download('airports')])
// Airport code -> country name (OpenFlights spelling, as used for airlines)
const airportCountry = new Map()
for (const row of airportsRaw) {
  const [, , , country, iata, icao] = row
  if (iata) airportCountry.set(iata, country)
  if (icao) airportCountry.set(icao, country)
}

// --- aircraft: OpenFlights/IATA equipment code -> ICAO type designator
const planeIcao = new Map()
for (const [, iata, icao] of planesRaw) if (iata && icao) planeIcao.set(iata, icao)

// --- airlines by OpenFlights id
const airlines = new Map()
for (const [id, name, , iata, icao, , country, active] of airlinesRaw) {
  airlines.set(id, { id, name, iata: iata && iata !== '-' ? iata : '', icao: icao && icao !== 'N/A' ? icao : '', country, active: active === 'Y' })
}

// IATA codes get reused after an airline closes, and OpenFlights' airline id on
// a route can point at the code's old owner. Pick the airline that holds the
// code today: seen flying live, else active and not known to have closed.
const byCode = new Map()
for (const a of airlines.values()) {
  for (const code of [a.iata, a.icao]) {
    if (!code) continue
    if (!byCode.has(code)) byCode.set(code, [])
    byCode.get(code).push(a)
  }
}
function currentHolder(code, fallback, countries) {
  const cands = byCode.get(code) ?? []
  if (cands.length <= 1) return fallback ?? cands[0]
  // Prefer: based in a country the route touches > seen flying live > active > not known closed.
  const score = (a) =>
    (countries.has(a.country) ? 8 : 0) +
    (a.icao && seen.has(a.icao) ? 4 : 0) +
    (a.active ? 2 : 0) -
    (a.icao && fixes.removed[a.icao] ? 16 : 0) +
    (a === fallback ? 1 : 0)
  return cands.reduce((best, a) => (score(a) > score(best) ? a : best), cands[0])
}

const stats = { routes: routesRaw.length, codeshareOrStops: 0, unknownAirport: 0, unknownAirline: 0, removedAirline: 0, merged: 0, inactiveAirline: 0, kept: 0 }
const removedBy = {}
const outAirlines = new Map() // icao/iata key -> index
const airlineList = []
const routeKeys = new Set()
const routes = []

const airlineIndex = (a) => {
  const key = a.icao || a.iata
  if (!outAirlines.has(key)) {
    outAirlines.set(key, airlineList.length)
    airlineList.push([a.icao, a.iata, a.name, a.country])
  }
  return outAirlines.get(key)
}

for (const r of routesRaw) {
  const [airlineCode, airlineId, src, , dst, , codeshare, stops, equipment] = r
  if (codeshare === 'Y' || (stops && stops !== '0')) { stats.codeshareOrStops++; continue }
  const dep = toIcao(src)
  const arr = toIcao(dst)
  if (!dep || !arr || dep === arr) { stats.unknownAirport++; continue }
  const countries = new Set([airportCountry.get(src), airportCountry.get(dst)].filter(Boolean))
  const override = [...countries].map((c) => fixes.codeOverrides?.[`${airlineCode}|${c}`]).find(Boolean)
  let a = override ? { ...override, active: true } : currentHolder(airlineCode, airlines.get(airlineId), countries)
  if (!a || (!a.icao && !a.iata)) { stats.unknownAirline++; continue }

  const liveKeep = a.icao && seen.has(a.icao)
  if (!liveKeep && a.icao && fixes.removed[a.icao]) {
    stats.removedAirline++
    removedBy[a.icao] = (removedBy[a.icao] ?? 0) + 1
    continue
  }
  if (!liveKeep && a.icao && fixes.mergedInto[a.icao]) {
    const to = fixes.mergedInto[a.icao]
    const succ = [...airlines.values()].find((x) => x.icao === to && x.active) ?? (fixes.addAirlines?.[to] ? { icao: to, ...fixes.addAirlines[to] } : null)
    if (!succ) { stats.removedAirline++; continue }
    a = succ
    stats.merged++
  } else if (!liveKeep && !a.active) {
    stats.inactiveAirline++
    continue
  }

  const equip = (equipment ?? '').trim().split(/\s+/).map((c) => planeIcao.get(c)).filter(Boolean)
  const idx = airlineIndex(a)
  const key = `${idx}|${dep}|${arr}`
  if (routeKeys.has(key)) continue
  routeKeys.add(key)
  routes.push([idx, dep, arr, [...new Set(equip)].join(' ')])
  stats.kept++
}

// --- model names for the aircraft types used (ours first, then OpenFlights')
const { TYPE_NAMES } = await import('../../server/aircraftTypes.ts')
const ofNames = new Map(planesRaw.filter((p) => p[2]).map(([name, , icao]) => [icao, name]))
const aircraft = {}
for (const r of routes) for (const t of r[3].split(' ').filter(Boolean)) aircraft[t] ??= TYPE_NAMES[t] ?? ofNames.get(t) ?? t

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  JSON.stringify({
    _about: 'Simulated-traffic route network. Derived from OpenFlights (https://openflights.org/data), ODbL 1.0; routes as of June 2014, cleaned with airline-fixes.json and live sightings. Build: node scripts/sim/build-routes.mjs',
    built: new Date().toISOString(),
    airlines: airlineList, // [icao, iata, name, country]
    aircraft, // ICAO type -> model name
    routes, // [airline index, departure ICAO, arrival ICAO, "ICAO type codes"]
  }),
)

const regionOf = (icao) => {
  const [, , , country, lat, lon] = AIRPORTS[icao]
  if (country === 'CN') return 'China'
  if (lat < 38 && lat > -36 && lon > -20 && lon < 52 && country !== 'IL') return 'Africa (approx.)'
  if (['US', 'CA'].includes(country)) return 'US/Canada'
  if (lon > -25 && lon < 45 && lat > 35) return 'Europe (approx.)'
  return 'Other'
}
const byRegion = {}
for (const [, dep] of routes) byRegion[regionOf(dep)] = (byRegion[regionOf(dep)] ?? 0) + 1
const withEquip = routes.filter((r) => r[3]).length
console.log(JSON.stringify({ ...stats, airlinesKept: airlineList.length, liveAirlinesKnown: seen.size, routesWithAircraft: withEquip, routesByDepartureRegion: byRegion, biggestRemoved: Object.entries(removedBy).sort((a, b) => b[1] - a[1]).slice(0, 8) }, null, 1))
console.log(`Wrote ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB)`)
