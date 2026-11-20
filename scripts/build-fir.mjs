// Builds public/data/fir-boundaries.json (en-route control boundaries / FIRs)
// from the VATSpy Data Project (https://github.com/vatsimnetwork/vatspy-data-project),
// licensed CC BY-SA 4.0. VATSpy splits many FIRs into sectors (e.g. BIRD-E);
// only whole FIRs are kept. Coordinates are rounded to ~100 m.
//
//   node scripts/build-fir.mjs            (downloads the current file)
//   node scripts/build-fir.mjs path.json  (uses a local copy)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson'
const ROOT = join(import.meta.dirname, '..')
const raw = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : await (await fetch(SRC)).json()

const round = (v) => Math.round(v * 1000) / 1000
// VATSpy flags only a few FIRs as oceanic; these well-known oceanic control
// areas are drawn dashed too.
const OCEANIC = new Set(['EGGX', 'CZQX', 'CZQO', 'LPPO', 'KZWY', 'TTZO', 'NZZO', 'PAZA', 'ENOB', 'GOOO', 'BGGL', 'NFFF', 'KZAK', 'KZNY', 'RJJJ', 'SBAO', 'SCIZ', 'SUEO', 'GCCO', 'FIMM', 'YBBB-O', 'AYPM-O'])
const seen = new Set()
const features = []
const labels = []
for (const f of raw.features) {
  const id = f.properties.id
  if (id.includes('-')) continue // a sector of a FIR, not the FIR itself
  // VATSIM-only groupings drawn over real FIRs (NAT, ADR, UKR, BAIRES, GUY...): real ones are 4-letter ICAO codes.
  if (!/^[A-Z]{4}$/.test(id)) continue
  const coords = f.geometry.coordinates.map((poly) =>
    poly.map((ring) => {
      const out = []
      for (const [x, y] of ring) {
        const p = [round(x), round(y)]
        const last = out[out.length - 1]
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
      }
      return out
    }),
  )
  const oceanic = f.properties.oceanic === '1' || f.properties.oceanic === 1 || OCEANIC.has(id)
  features.push({ type: 'Feature', properties: { id, oceanic }, geometry: { type: 'MultiPolygon', coordinates: coords } })
  if (!seen.has(id) && f.properties.label_lon != null) {
    seen.add(id)
    labels.push({ type: 'Feature', properties: { id, oceanic }, geometry: { type: 'Point', coordinates: [round(+f.properties.label_lon), round(+f.properties.label_lat)] } })
  }
}
// Edge labels: points along each FIR's border every ~SPACING_KM, rotated to
// follow the edge, with `s` saying which side (of the text) the FIR is on, so
// the client can nudge each label just inside its own FIR. Neighbours share
// borders, so each side of a border gets its own FIR's code.
const SPACING_KM = 600
const R = Math.PI / 180
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * R) / 2)) / R
const km = (a, b) => {
  const h = Math.sin(((b[1] - a[1]) * R) / 2) ** 2 + Math.cos(a[1] * R) * Math.cos(b[1] * R) * Math.sin(((b[0] - a[0]) * R) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}
const edgeLabels = []
for (const f of features) {
  for (const poly of f.geometry.coordinates) {
    const ring = poly[0]
    if (!ring || ring.length < 4) continue
    // Ring orientation (shoelace in lon/lat): counter-clockwise = inside on the left.
    let area = 0
    for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    const insideLeft = area > 0
    let perimeter = 0
    for (let i = 0; i < ring.length - 1; i++) perimeter += km(ring[i], ring[i + 1])
    if (perimeter < 150) continue
    const step = Math.max(SPACING_KM, perimeter / Math.max(1, Math.round(perimeter / SPACING_KM)))
    let next = step / 2 // first label halfway into the first stretch
    let walked = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]
      const b = ring[i + 1]
      const d = km(a, b)
      while (d > 0 && walked + d >= next) {
        const t = (next - walked) / d
        next += step
        if (Math.abs(b[0] - a[0]) > 180) continue // crosses the date line
        const lon = a[0] + (b[0] - a[0]) * t
        const lat = a[1] + (b[1] - a[1]) * t
        if (Math.abs(lat) > 82) continue
        // Screen angle of the edge (clockwise from east, y down), kept upright.
        let angle = (Math.atan2(-(mercY(b[1]) - mercY(a[1])), b[0] - a[0]) / R)
        let flipped = false
        if (angle > 90) (angle -= 180), (flipped = true)
        else if (angle < -90) (angle += 180), (flipped = true)
        // In the text's frame, "up" (negative y) is left of the direction of reading.
        const insideUp = insideLeft !== flipped
        edgeLabels.push({
          type: 'Feature',
          properties: { id: f.properties.id, r: Math.round(angle), s: insideUp ? -1 : 1 },
          geometry: { type: 'Point', coordinates: [round(lon), round(lat)] },
        })
      }
      walked += d
    }
  }
}

mkdirSync(join(ROOT, 'public', 'data'), { recursive: true })
const out = {
  _about: 'En-route control boundaries (FIRs), from the VATSpy Data Project (github.com/vatsimnetwork/vatspy-data-project), CC BY-SA 4.0. Approximate, for display only; not for navigation. Built by scripts/build-fir.mjs.',
  boundaries: { type: 'FeatureCollection', features },
  labels: { type: 'FeatureCollection', features: labels },
  edgeLabels: { type: 'FeatureCollection', features: edgeLabels },
}
writeFileSync(join(ROOT, 'public', 'data', 'fir-boundaries.json'), JSON.stringify(out))
console.log(`${features.length} FIRs, ${labels.length} centre labels, ${edgeLabels.length} edge labels`)
