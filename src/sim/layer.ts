// Simulated traffic: the map layer (hollow outlines, under live aircraft).
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import { ICON } from '../flights/icons'
import gapAreas from '../../data/sim/gap-areas.json'

export const SIM_SOURCE = 'sim-aircraft'
export const SIM_LAYER = 'sim-icons'
const AREAS = 'sim-areas'

// Same zoom scaling as live aircraft (src/flights/layer.ts).
const iconSize = [
  'interpolate', ['linear'], ['zoom'],
  1, ['*', 0.42, ['get', 's']],
  4, ['*', 0.62, ['get', 's']],
  8, ['*', 0.95, ['get', 's']],
  12, ['*', 1.35, ['get', 's']],
] as unknown as ExpressionSpecification

export function addSimLayer(map: MLMap, beforeId?: string) {
  if (map.getSource(SIM_SOURCE)) return
  // The gap areas, outlined (hidden unless "Show simulation areas" is on).
  map.addSource(AREAS, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: gapAreas.areas.map((a) => ({
        type: 'Feature' as const,
        properties: { name: a.name },
        geometry: { type: 'Polygon' as const, coordinates: [[...a.ring, a.ring[0]]] },
      })),
    },
  })
  map.addLayer(
    { id: `${AREAS}-fill`, type: 'fill', source: AREAS, layout: { visibility: 'none' }, paint: { 'fill-color': '#f2c6d2', 'fill-opacity': 0.06 } },
    beforeId,
  )
  map.addLayer(
    {
      id: `${AREAS}-line`,
      type: 'line',
      source: AREAS,
      layout: { visibility: 'none' },
      paint: { 'line-color': '#f2c6d2', 'line-opacity': 0.55, 'line-width': 1.2, 'line-dasharray': [3, 2] },
    },
    beforeId,
  )
  map.addSource(SIM_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0, buffer: 32, maxzoom: 10 })
  map.addLayer(
    {
      id: SIM_LAYER,
      type: 'symbol',
      source: SIM_SOURCE,
      layout: {
        'icon-image': ICON.sim,
        'icon-size': iconSize,
        'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['get', 'v'] },
    },
    beforeId,
  )
}

export function removeSimLayer(map: MLMap) {
  for (const id of [SIM_LAYER, `${AREAS}-fill`, `${AREAS}-line`]) if (map.getLayer(id)) map.removeLayer(id)
  for (const id of [SIM_SOURCE, AREAS]) if (map.getSource(id)) map.removeSource(id)
}

export function setAreasVisible(map: MLMap, visible: boolean) {
  for (const id of [`${AREAS}-fill`, `${AREAS}-line`]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
}

let lastUrl: string | null = null
/** Hand the worker's GeoJSON text to the map (parsed by MapLibre's own worker). */
export function setSimData(map: MLMap, text: string) {
  const src = map.getSource(SIM_SOURCE) as GeoJSONSource | undefined
  if (!src) return
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  src.setData(url)
  const old = lastUrl
  lastUrl = url
  if (old) setTimeout(() => URL.revokeObjectURL(old), 10_000)
}
