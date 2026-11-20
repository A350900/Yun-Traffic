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
mkdirSync(join(ROOT, 'public', 'data'), { recursive: true })
const out = {
  _about: 'En-route control boundaries (FIRs), from the VATSpy Data Project (github.com/vatsimnetwork/vatspy-data-project), CC BY-SA 4.0. Approximate, for display only; not for navigation. Built by scripts/build-fir.mjs.',
  boundaries: { type: 'FeatureCollection', features },
  labels: { type: 'FeatureCollection', features: labels },
}
writeFileSync(join(ROOT, 'public', 'data', 'fir-boundaries.json'), JSON.stringify(out))
console.log(`${features.length} FIRs, ${labels.length} labels`)
