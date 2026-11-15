import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { nightPolygon } from './solar'

const SOURCE = 'day-night'
const LAYER = 'day-night'

/**
 * Sun altitude thresholds, outermost first. The shapes are nested and drawn
 * on top of each other, so darkness builds up: sunset → civil twilight →
 * nautical twilight → astronomical twilight (full night).
 */
const BANDS = [
  { name: 'sunset', altitude: -0.833 }, // sun's upper edge on the horizon (incl. refraction)
  { name: 'civil', altitude: -6 },
  { name: 'nautical', altitude: -12 },
  { name: 'astronomical', altitude: -18 },
]

/** Opacity added by each band; four stacked ≈ 0.6 in full night. */
const BAND_OPACITY = 0.2
const NIGHT_COLOR = '#000000'

function build(date: Date): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: BANDS.map((b) => ({
      type: 'Feature',
      properties: { band: b.name },
      geometry: { type: 'Polygon', coordinates: [nightPolygon(date, b.altitude)] },
    })),
  }
}

/** Adds the overlay under the basemap's labels so place names stay readable. */
export function addDayNightLayer(map: MLMap, visible: boolean) {
  if (map.getSource(SOURCE)) return
  map.addSource(SOURCE, { type: 'geojson', data: build(new Date()), tolerance: 0.2 })
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
  map.addLayer(
    {
      id: LAYER,
      type: 'fill',
      source: SOURCE,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: { 'fill-color': NIGHT_COLOR, 'fill-opacity': BAND_OPACITY, 'fill-antialias': false },
    },
    firstSymbol,
  )
}

export function updateDayNight(map: MLMap, date = new Date()) {
  ;(map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(build(date))
}

export function setDayNightVisible(map: MLMap, visible: boolean) {
  if (map.getLayer(LAYER)) map.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none')
}
