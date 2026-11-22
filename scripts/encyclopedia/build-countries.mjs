// Builds public/data/country-airlines.json for Encyclopedia mode: each country
// in data/encyclopedia/country-airlines.json with where to put its airline
// stack (Natural Earth label point) and its land area (for sizing).
// Natural Earth is public domain (naturalearthdata.com).
//
//   node scripts/encyclopedia/build-countries.mjs [path/to/ne_50m_admin_0_countries.geojson]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'
const ne = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : await (await fetch(SRC)).json()
const source = JSON.parse(readFileSync(join(ROOT, 'data', 'encyclopedia', 'country-airlines.json'), 'utf8'))
const airlines = source.countries
const priority = new Set(source.priority?.countries ?? [])
const anchors = source.priority?.anchors ?? {}

// Area of a lon/lat ring on a sphere (km²).
const R = 6371
const rad = Math.PI / 180
function ringArea(ring) {
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    s += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad))
  }
  return Math.abs((s * R * R) / 2)
}
function area(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  return polys.reduce((sum, p) => sum + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0)
}

const byIso = new Map()
for (const f of ne.features) {
  const p = f.properties
  // ISO_A2_EH fills the gaps in ISO_A2 (France and Norway are -99, Taiwan is CN-TW there)
  const iso = /^[A-Z]{2}$/.test(p.ISO_A2) ? p.ISO_A2 : p.ISO_A2_EH
  if (!iso || iso === '-99' || byIso.has(iso)) continue
  byIso.set(iso, { name: p.NAME, lon: +p.LABEL_X.toFixed(3), lat: +p.LABEL_Y.toFixed(3), areaKm2: Math.round(area(f.geometry)) })
}

const countries = []
const missing = []
for (const [iso, list] of Object.entries(airlines)) {
  const c = byIso.get(iso)
  if (!c) {
    missing.push(iso)
    continue
  }
  countries.push({ iso, ...c, airlines: list, ...(priority.has(iso) ? { priority: true } : {}), ...(typeof anchors[iso] === 'string' ? { anchor: anchors[iso] } : {}) })
}
mkdirSync(join(ROOT, 'public', 'data'), { recursive: true })
writeFileSync(
  join(ROOT, 'public', 'data', 'country-airlines.json'),
  JSON.stringify({ _about: 'Built by scripts/encyclopedia/build-countries.mjs. Positions and areas: Natural Earth (public domain).', countries }),
)
console.log(`${countries.length} countries` + (missing.length ? `; not in Natural Earth: ${missing.join(', ')}` : ''))
