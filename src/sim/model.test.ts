// Simulated traffic: checks for the schedule model.  Run: npm run test:sim
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimModel } from './model.ts'
import { SIM_CONFIG } from './config.ts'
import { regionOf } from '../../shared/sim/regions.ts'
import type { SimData } from './types.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const data: SimData = {
  routes: read('data/sim/routes.json'),
  airports: read('data/airports.json'),
  model: read('data/sim/traffic-model.json'),
  calibration: read('data/sim/calibration.json'),
}
const model = new SimModel(data)
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo, d, h, mi)

test('deterministic: the same date gives the same timetable', () => {
  const a = new SimModel(data).day('2024-07-11')
  const b = new SimModel(data).day('2024-07-11')
  assert.equal(a.length, b.length)
  assert.deepEqual(a.slice(0, 50), b.slice(0, 50))
})

test('global airborne at the July peak is within 5% of Eurocontrol (~14,913)', () => {
  const n = model.countAirborne(at(2024, 6, 11, 14, 22))
  const target = data.model.globalAirborne.julyPeak.value
  assert.ok(Math.abs(n - target) / target < 0.05, `${n} vs ${target}`)
})

test('winter is quieter than summer', () => {
  assert.ok(model.countAirborne(at(2024, 10, 3, 14, 22)) < model.countAirborne(at(2024, 6, 11, 14, 22)))
})

test('China is busier in Beijing daytime than at night', () => {
  const count = (t: number) => {
    let n = 0
    for (const f of model.airborne(t)) {
      const p = model.position(f, t)
      if (regionOf(p.lat, p.lon) === 'china') n++
    }
    return n
  }
  assert.ok(count(at(2024, 6, 11, 2)) > 2 * count(at(2024, 6, 11, 19)), 'Beijing 10:00 vs 03:00')
})

test('North Atlantic flows the right way: eastbound overnight, westbound by day', () => {
  const flows = (t: number) => {
    let east = 0
    let west = 0
    for (const f of model.airborne(t)) {
      const p = model.position(f, t)
      if (regionOf(p.lat, p.lon) !== 'natl') continue
      if (p.track > 0 && p.track < 180) east++
      else west++
    }
    return { east, west }
  }
  const night = flows(at(2024, 6, 11, 3))
  const day = flows(at(2024, 6, 11, 15))
  assert.ok(night.east > 3 * night.west, JSON.stringify(night))
  assert.ok(day.west > 3 * day.east, JSON.stringify(day))
})

test('never visible near airports; fully visible in cruise', () => {
  const t = at(2024, 6, 11, 12)
  let checked = 0
  for (const f of model.airborne(t)) {
    const p = model.position(f, t)
    const nmFrom = (p.progress * p.route.km) / 1.852
    const nmTo = ((1 - p.progress) * p.route.km) / 1.852
    const near = Math.min(nmFrom, nmTo)
    if (near < SIM_CONFIG.hideWithinNm) assert.equal(p.visibility, 0)
    if (near > SIM_CONFIG.fadeUntilNm) assert.equal(p.visibility, 1)
    if (++checked > 5000) break
  }
})

test('positions are on the map and headings sensible', () => {
  const t = at(2024, 6, 11, 8)
  let n = 0
  for (const f of model.airborne(t)) {
    const p = model.position(f, t)
    assert.ok(p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180)
    assert.ok(p.track >= 0 && p.track < 360)
    assert.ok(p.altitudeFt >= 15000 && p.altitudeFt <= 45000)
    if (++n > 2000) break
  }
})
