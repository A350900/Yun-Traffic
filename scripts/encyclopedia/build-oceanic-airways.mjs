// Builds public/data/oceanic-airways.json: fixed airways that run mostly over
// the sea (Pacific, western Atlantic/WATRS, Gulf of Mexico, Caribbean...), from
// the FAA's ATS Route dataset (public domain; US-published routes, which cover
// the Oakland, Anchorage, New York, Houston, Miami and San Juan oceanic areas).
// Land: Natural Earth (public domain).
//
//   node scripts/encyclopedia/build-oceanic-airways.mjs [ats.geojson] [ne_50m_admin_0_countries.geojson]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const ATS = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0/query'
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'

async function loadAts() {
  if (process.argv[2]) return JSON.parse(readFileSync(process.argv[2], 'utf8')).features
  // Everything except the domestic networks (J/V/Q/T routes)
  const where = "IDENT NOT LIKE 'J%' AND IDENT NOT LIKE 'V%' AND IDENT NOT LIKE 'Q%' AND IDENT NOT LIKE 'T%'"
  const feats = []
  for (let off = 0; ; off += 2000) {
    const q = new URLSearchParams({ where, outFields: 'IDENT', returnGeometry: 'true', outSR: '4326', f: 'geojson', resultOffset: String(off), resultRecordCount: '2000' })
    const page = (await (await fetch(`${ATS}?${q}`)).json()).features
    feats.push(...page)
    if (page.length < 2000) return feats
  }
}
const ats = await loadAts()
const ne = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : await (await fetch(NE)).json()

// land polygons with bounding boxes, for a quick "is this point on land?"
const land = []
for (const f of ne.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  for (const p of polys) {
    const ring = p[0]
    let w = 180, e = -180, s = 90, n = -90
    for (const [x, y] of ring) (w = Math.min(w, x)), (e = Math.max(e, x)), (s = Math.min(s, y)), (n = Math.max(n, y))
    land.push({ ring, w, e, s, n })
  }
}
function onLand(lon, lat) {
  const x = ((lon + 540) % 360) - 180
  for (const p of land) {
    if (x < p.w || x > p.e || lat < p.s || lat > p.n) continue
    let c = false
    const r = p.ring
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]
      const [xj, yj] = r[j]
      if (yi > lat !== yj > lat && x < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c
    }
    if (c) return true
  }
  return false
}
const R = Math.PI / 180
const km = ([a, b], [c, d]) => 2 * 6371 * Math.asin(Math.sqrt(Math.sin(((d - b) * R) / 2) ** 2 + Math.cos(b * R) * Math.cos(d * R) * Math.sin(((c - a) * R) / 2) ** 2))

// per route: length over sea vs land (sampled every ~20 km)
const routes = new Map()
for (const f of ats) {
  const id = f.properties.IDENT
  if (!f.geometry) continue
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates
  let r = routes.get(id)
  if (!r) routes.set(id, (r = { lines: [], sea: 0, total: 0 }))
  for (const line of lines) {
    r.lines.push(line.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]))
    for (let i = 0; i + 1 < line.length; i++) {
      const d = km(line[i], line[i + 1])
      const n = Math.max(1, Math.round(d / 20))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        const lon = line[i][0] + (line[i + 1][0] - line[i][0]) * t
        const lat = line[i][1] + (line[i + 1][1] - line[i][1]) * t
        if (!onLand(lon, lat)) r.sea += d / n
      }
      r.total += d
    }
  }
}
const features = []
for (const [id, r] of routes) {
  if (r.total < 250 || r.sea < 200 || r.sea / r.total < 0.7) continue // overland or very short
  features.push({ type: 'Feature', properties: { id, km: Math.round(r.total) }, geometry: { type: 'MultiLineString', coordinates: r.lines } })
}
mkdirSync(join(ROOT, 'public', 'data'), { recursive: true })
writeFileSync(
  join(ROOT, 'public', 'data', 'oceanic-airways.json'),
  JSON.stringify({ _about: 'Oceanic airways from the FAA ATS Route dataset (public domain), routes mostly over the sea. Built by scripts/encyclopedia/build-oceanic-airways.mjs.', type: 'FeatureCollection', features }),
)
console.log(`${features.length} oceanic routes of ${routes.size}: ${features.map((f) => f.properties.id).sort().join(' ')}`)
