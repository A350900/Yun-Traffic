// Simulated traffic: the map layer (hollow outlines, under live aircraft).
import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import { ICON } from '../flights/icons'

export const SIM_SOURCE = 'sim-aircraft'
export const SIM_LAYER = 'sim-icons'

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
  if (map.getLayer(SIM_LAYER)) map.removeLayer(SIM_LAYER)
  if (map.getSource(SIM_SOURCE)) map.removeSource(SIM_SOURCE)
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
