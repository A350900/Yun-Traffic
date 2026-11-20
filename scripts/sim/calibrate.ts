// Simulated traffic: calibrate and check the schedule model.
//   npx tsx scripts/sim/calibrate.ts          checks with the saved calibration
//   npx tsx scripts/sim/calibrate.ts --write  recalibrate and save data/sim/calibration.json
//
// 1. Regions with published daily flight counts (traffic-model.json
//    "regionalDailyFlights") get multipliers so their share of global flights
//    matches; other countries keep the route network's proportions.
// 2. One overall scale makes the global airborne count at the July peak
//    (2024-07-11 14:22 UTC) match Eurocontrol's ~14,913.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimModel } from '../../src/sim/model.ts'
import { SIM_CONFIG } from '../../src/sim/config.ts'
import { corridorOf, countryPair } from '../../src/sim/schedule.ts'
import { regionOf } from '../../shared/sim/regions.ts'
import type { Calibration, SimData } from '../../src/sim/types.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const CAL_FILE = join(ROOT, 'data', 'sim', 'calibration.json')
const base: SimData = { routes: read('data/sim/routes.json'), airports: read('data/airports.json'), model: read('data/sim/traffic-model.json'), cargo: read('data/sim/cargo-routes.json') }
const PEAK = Date.UTC(2024, 6, 11, 14, 22)
const AVG_DAY = '2024-05-15' // mid-season weekday: monthly/weekday factors close to 1
const targets = base.model.regionalDailyFlights
const world = targets.world.flights

function departuresByCountry(m: SimModel, key: string) {
  const by: Record<string, number> = {}
  for (const f of m.day(key)) {
    const c = base.airports[m.routes[f.route].dep][3]
    by[c] = (by[c] ?? 0) + 1
  }
  return by
}

const corridors = Object.entries(base.model.corridorDailyFlights ?? {}).filter(([k]) => !k.startsWith('_')) as [string, { flights: number }][]
const pairTargets = Object.entries(base.model.pairDailyFlights ?? {}).filter(([k]) => !k.startsWith('_')) as [string, { flights: number }][]
function flightsByPair(m: SimModel, key: string) {
  const by: Record<string, number> = {}
  for (const f of m.day(key)) {
    const r = m.routes[f.route]
    if (r.key.startsWith('c')) continue // freighters aren't in the passenger targets
    const k = countryPair(base.airports[r.dep][3], base.airports[r.arr][3])
    by[k] = (by[k] ?? 0) + 1
  }
  return by
}
function flightsByCorridor(m: SimModel, key: string) {
  const by: Record<string, number> = {}
  for (const f of m.day(key)) {
    const r = m.routes[f.route]
    const a = base.airports[r.dep]
    const b = base.airports[r.arr]
    const c = corridorOf({ country: a[3], lat: a[4], lon: a[5] }, { country: b[3], lat: b[4], lon: b[5] })
    if (c) by[c] = (by[c] ?? 0) + 1
  }
  return by
}

/** Regional shares + global peak, for a given distance setting. */
function calibrate(distanceSoftenKm: number, log = false): Calibration {
  const cal: Calibration = { scale: SIM_CONFIG.defaultScale, distanceSoftenKm, countryMultipliers: {}, corridorMultipliers: {}, pairMultipliers: {} }
  for (let pass = 1; pass <= 6; pass++) {
    const m = new SimModel({ ...base, calibration: cal })
    const by = departuresByCountry(m, AVG_DAY)
    const total = Object.values(by).reduce((a, b) => a + b, 0)
    for (const [name, t] of Object.entries(targets)) {
      if (!t.countries) continue
      const have = t.countries.reduce((s, c) => s + (by[c] ?? 0), 0)
      const want = (t.flights / world) * total
      const adj = have > 0 ? want / have : 1
      for (const c of t.countries) cal.countryMultipliers[c] = +((cal.countryMultipliers[c] ?? 1) * adj).toFixed(4)
      if (log && pass === 6) console.log(`  ${name}: ${have} -> want ${Math.round(want)}`)
    }
    const byCorridor = flightsByCorridor(new SimModel({ ...base, calibration: cal }), AVG_DAY)
    for (const [name, t] of corridors) {
      const have = byCorridor[name] ?? 0
      const want = (t.flights / world) * total
      if (have > 0) cal.corridorMultipliers![name] = +((cal.corridorMultipliers![name] ?? 1) * (want / have)).toFixed(4)
      if (log && pass === 6) console.log(`  ${name}: ${have} -> want ${Math.round(want)}`)
    }
    const byPair = flightsByPair(new SimModel({ ...base, calibration: cal }), AVG_DAY)
    for (const [name, t] of pairTargets) {
      const have = byPair[name] ?? 0
      const want = (t.flights / world) * total
      if (have > 0) cal.pairMultipliers![name] = +((cal.pairMultipliers![name] ?? 1) * (want / have)).toFixed(4)
      else if (log && pass === 6) console.log(`  ${name}: no routes in the data`)
    }
    const n = new SimModel({ ...base, calibration: cal }).countAirborne(PEAK)
    cal.scale = +(cal.scale * (base.model.globalAirborne.julyPeak.value / n)).toPrecision(5)
  }
  return cal
}

let cal: Calibration
if (process.argv.includes('--write')) {
  // Search the distance setting: matching the airborne peak AND the daily flight
  // count means flights have a realistic average length (otherwise long-haul
  // flights over oceans and poles end up over-represented).
  let best: { cal: Calibration; flights: number } | null = null
  for (const soften of [2500, 1800, 1300, 1000, 800, 650, 500, 400, 320, 260, 200]) {
    const c = calibrate(soften)
    const flights = new SimModel({ ...base, calibration: c }).day(AVG_DAY).length
    console.log(`distance setting ${soften} km: ${flights.toLocaleString()} flights/day (target ${world.toLocaleString()})`)
    if (!best || Math.abs(flights - world) < Math.abs(best.flights - world)) best = { cal: c, flights }
    if (flights > world) break
  }
  cal = best!.cal
  console.log(`chosen distance setting ${cal.distanceSoftenKm} km`)
  calibrate(cal.distanceSoftenKm!, true)
  writeFileSync(CAL_FILE, JSON.stringify({ _about: 'Written by scripts/sim/calibrate.ts --write. Do not edit by hand.', calibratedAt: new Date().toISOString(), ...cal }, null, 2) + '\n')
  console.log(`saved ${CAL_FILE}`)
} else {
  cal = read('data/sim/calibration.json')
}

const m = new SimModel({ ...base, calibration: cal })
const curve = (y: number, mo: number, d: number) => Array.from({ length: 24 }, (_, h) => m.countAirborne(Date.UTC(y, mo, d, h, 30)))
const fmt = (c: number[]) => c.map((n, h) => `${String(h).padStart(2, '0')}h ${String(n).padStart(6)}`).join('  ')
const july = curve(2024, 6, 11)
const nov = curve(2024, 10, 3)
console.log(`\nJuly 11 2024 (Thu), airborne by UTC hour:\n${fmt(july)}`)
console.log(`  max ${Math.max(...july)} at ${july.indexOf(Math.max(...july))}:30 UTC  (Eurocontrol: ${base.model.globalAirborne.julyPeak.value} at 14:15)`)
console.log(`  min ${Math.min(...july)} at ${july.indexOf(Math.min(...july))}:30 UTC`)
console.log(`\nNov 3 2024 (Sun), airborne by UTC hour:\n${fmt(nov)}`)
console.log(`  min ${Math.min(...nov)} at ${nov.indexOf(Math.min(...nov))}:30 UTC  (Eurocontrol: ${base.model.globalAirborne.novemberTrough.value} at 04:45)`)

const avg = departuresByCountry(m, AVG_DAY)
const avgTotal = Object.values(avg).reduce((a, b) => a + b, 0)
console.log(`\nflights on an average day (${AVG_DAY}): ${avgTotal.toLocaleString()}  (IATA: ~${world.toLocaleString()})`)
const avgPair = flightsByPair(m, AVG_DAY)
console.log('  pairs: ' + pairTargets.map(([k, t]) => `${k} ${avgPair[k] ?? 0}/${t.flights}`).join(', '))
const avgCorr = flightsByCorridor(m, AVG_DAY)
for (const [name, t] of corridors) console.log(`  ${name}: ${avgCorr[name] ?? 0}  (target ${t.flights})`)
for (const [name, t] of Object.entries(targets)) {
  if (!t.countries) continue
  console.log(`  ${name.padEnd(7)} ${String(t.countries.reduce((s, c) => s + (avg[c] ?? 0), 0)).padStart(6)}  (target ${t.flights})`)
}

for (const [label, t] of [
  ['02:00 UTC (Beijing 10:00, US night)', Date.UTC(2024, 6, 11, 2)],
  ['14:00 UTC (Beijing 22:00, US morning)', Date.UTC(2024, 6, 11, 14)],
  ['19:00 UTC (Beijing 03:00, US afternoon)', Date.UTC(2024, 6, 11, 19)],
] as const) {
  const reg: Record<string, number> = {}
  for (const f of m.airborne(t)) {
    const p = m.position(f, t)
    const r = regionOf(p.lat, p.lon)
    reg[r] = (reg[r] ?? 0) + 1
  }
  console.log(`\n${label}: ${Object.entries(reg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
}
console.log('(North Atlantic reference: ~1,590 Europe-North America flights/day, ~4 h each inside this box -> ~265 on average, plus Africa/Caribbean/S. America-Europe; overnight eastbound and daytime westbound waves)')
for (const h of [3, 15]) {
  const t = Date.UTC(2024, 6, 11, h)
  let east = 0
  let west = 0
  for (const f of m.airborne(t)) {
    const p = m.position(f, t)
    if (regionOf(p.lat, p.lon) !== 'natl') continue
    if (p.track > 0 && p.track < 180) east++
    else west++
  }
  console.log(`North Atlantic ${h}:00 UTC: ${east} eastbound, ${west} westbound`)
}
