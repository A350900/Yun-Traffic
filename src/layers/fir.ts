import type { FeatureCollection } from 'geojson'
import type { Map as MLMap } from 'maplibre-gl'

/**
 * En-route control boundaries (FIRs) worldwide, from the VATSpy Data Project
 * (CC BY-SA 4.0; built into public/data/fir-boundaries.json by
 * scripts/build-fir.mjs). Loaded only the first time the layer is switched on.
 * Land FIRs are solid lines, oceanic ones dashed; codes appear when zoomed in.
 */

const SRC = 'fir-boundaries'
const LABELS = 'fir-labels'
const LAYERS = ['fir-line', 'fir-line-oceanic', 'fir-label']
/** Our own overlays the boundaries go underneath, in drawing order. */
const UNDER = ['sim-areas-fill', 'path-remaining', 'sim-icons']

let data: Promise<{ boundaries: FeatureCollection; labels: FeatureCollection }> | null = null

function firstExisting(map: MLMap, ids: string[], fallback?: string) {
  return ids.find((id) => map.getLayer(id)) ?? fallback
}

async function add(map: MLMap, beforeLayer?: string) {
  data ??= fetch('/data/fir-boundaries.json').then((r) => {
    if (!r.ok) throw new Error(`boundaries: HTTP ${r.status}`)
    return r.json()
  })
  let d
  try {
    d = await data
  } catch {
    data = null // try again next time it's switched on
    return
  }
  if (map.getLayer(LAYERS[0])) return
  if (!map.getSource(SRC)) map.addSource(SRC, {
      type: 'geojson',
      data: d.boundaries,
      tolerance: 0.6,
      attribution: 'Boundaries: <a href="https://github.com/vatsimnetwork/vatspy-data-project" target="_blank" rel="noreferrer">VATSpy Data Project</a> (CC BY-SA 4.0)',
    })
  if (!map.getSource(LABELS)) map.addSource(LABELS, { type: 'geojson', data: d.labels })
  const before = firstExisting(map, UNDER, beforeLayer)
  const line = { 'line-color': '#f2c6d2', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.1] } as const
  map.addLayer({ id: 'fir-line', type: 'line', source: SRC, filter: ['!', ['get', 'oceanic']], paint: { ...line, 'line-opacity': 0.32 } } as never, before)
  map.addLayer(
    { id: 'fir-line-oceanic', type: 'line', source: SRC, filter: ['get', 'oceanic'], paint: { ...line, 'line-opacity': 0.26, 'line-dasharray': [3, 3] } } as never,
    before,
  )
  map.addLayer(
    {
      id: 'fir-label',
      type: 'symbol',
      source: LABELS,
      minzoom: 3.5,
      layout: { 'text-field': ['get', 'id'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-letter-spacing': 0.08 },
      paint: { 'text-color': '#f2c6d2', 'text-opacity': 0.55, 'text-halo-color': 'rgba(10, 6, 14, 0.85)', 'text-halo-width': 1.2 },
    },
    before,
  )
}

/** Show or hide the boundaries (loading them the first time). */
export function setFirVisible(map: MLMap, visible: boolean, beforeLayer?: string) {
  if (visible && !map.getLayer(LAYERS[0])) {
    void add(map, beforeLayer)
    return
  }
  for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
}
