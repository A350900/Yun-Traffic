#!/usr/bin/env node
// Builds data/sim/coverage-seed.json: a starting coverage map for fresh
// installs (used until the server has recorded a day of its own).
//   node scripts/sim/build-coverage-seed.mjs http://localhost:8787 [samples] [minutesApart]
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [url = 'http://localhost:8787', n = '3', gap = '4'] = process.argv.slice(2)
const CELL = 2
const seen = new Map() // cell -> [samples with aircraft, total aircraft]
const hours = new Set()
for (let i = 0; i < +n; i++) {
  if (i) await new Promise((r) => setTimeout(r, +gap * 60_000))
  const body = await (await fetch(`${url}/api/aircraft`)).json()
  hours.add(new Date(body.now).getUTCHours())
  const counts = new Map()
  for (const ac of body.aircraft) {
    if (body.now - ac[9] > 5 * 60_000) continue // fresh positions only
    const k = `${Math.floor(ac[1] / CELL)},${Math.floor(ac[2] / CELL)}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  for (const [k, c] of counts) {
    const s = seen.get(k) ?? [0, 0]
    seen.set(k, [s[0] + 1, s[1] + c])
  }
  console.log(`sample ${i + 1}/${n}: ${counts.size} cells with live aircraft`)
}
const cells = {}
for (const [k, [hits, total]] of seen) cells[k] = [+(hits / +n).toFixed(3), +(total / +n).toFixed(2)]
writeFileSync(
  join(ROOT, 'data', 'sim', 'coverage-seed.json'),
  JSON.stringify({ _about: `Starting coverage map: 2° cells -> [share of samples with live aircraft, average count] at the UTC hour(s) in "hours". ${n} samples, ${new Date().toISOString()}. Rebuild with scripts/sim/build-coverage-seed.mjs.`, hours: [...hours], cells }),
)
console.log(`wrote ${Object.keys(cells).length} cells`)
