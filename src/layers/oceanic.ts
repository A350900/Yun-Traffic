import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl'

/**
 * Oceanic routes:
 *  - fixed oceanic airways (FAA ATS Route data: Pacific, western Atlantic /
 *    WATRS, Gulf of Mexico, Caribbean), thin lines with their names along them;
 *  - the North Atlantic Tracks of the day (from the server: /api/tracks/nat),
 *    bolder, lettered at both ends, westbound and eastbound in two shades.
 * Loaded only the first time the layer is switched on; the tracks refresh every
 * 30 minutes while it's on.
 */

const AIRWAYS = 'oceanic-airways'
const NAT = 'nat-tracks'
const NAT_ENDS = 'nat-track-ends'
const LAYERS = ['oceanic-airways-line', 'oceanic-airways-label', 'nat-tracks-line', 'nat-tracks-end', 'nat-tracks-end-label']
/** Our own overlays the routes go underneath. */
const UNDER = ['sim-areas-fill', 'path-remaining', 'sim-icons', 'country-airlines', 'major-airport-pins']

const AIRWAY = '#8fb7d9'
const WEST = '#f2c6d2' // --brand-soft: westbound (daytime) tracks
const EAST = '#e07a9a' // deeper pink: eastbound (night) tracks

let loading: Promise<void> | null = null
let natTimer = 0

type NatTrack = { id: string; dir: 'west' | 'east' | null; points: [number, number][]; from: string | null; to: string | null; levels: string | null }

async function loadNat(map: MLMap) {
  let data: { tracks: NatTrack[]; valid: string[] }
  try {
    data = await (await fetch('/api/tracks/nat')).json()
  } catch {
    return // offline and no server
  }
  const lines = data.tracks.map((t) => ({
    type: 'Feature' as const,
    properties: { id: t.id, dir: t.dir ?? 'west', levels: t.levels ?? '', from: t.from ?? '', to: t.to ?? '' },
    geometry: { type: 'LineString' as const, coordinates: t.points },
  }))
  const ends = data.tracks.flatMap((t) =>
    [t.points[0], t.points[t.points.length - 1]].map((p) => ({
      type: 'Feature' as const,
      properties: { id: t.id, dir: t.dir ?? 'west' },
      geometry: { type: 'Point' as const, coordinates: p },
    })),
  )
  ;(map.getSource(NAT) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: lines })
  ;(map.getSource(NAT_ENDS) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: ends })
}

async function add(map: MLMap) {
  const airways = await (await fetch('/data/oceanic-airways.json')).json()
  if (map.getLayer(LAYERS[0])) return
  const before = UNDER.find((id) => map.getLayer(id))
  const empty = { type: 'FeatureCollection' as const, features: [] }
  map.addSource(AIRWAYS, { type: 'geojson', data: airways, attribution: 'Oceanic airways: FAA' })
  map.addSource(NAT, { type: 'geojson', data: empty, attribution: 'North Atlantic Tracks: FAA / NAV CANADA / NATS' })
  map.addSource(NAT_ENDS, { type: 'geojson', data: empty })
  const dirColor = ['match', ['get', 'dir'], 'east', EAST, WEST] as unknown as ExpressionSpecification
  map.addLayer(
    {
      id: 'oceanic-airways-line',
      type: 'line',
      source: AIRWAYS,
      paint: { 'line-color': AIRWAY, 'line-opacity': 0.42, 'line-width': ['interpolate', ['linear'], ['zoom'], 1.5, 0.5, 6, 1.2] as unknown as ExpressionSpecification },
    },
    before,
  )
  map.addLayer(
    {
      id: 'oceanic-airways-label',
      type: 'symbol',
      source: AIRWAYS,
      minzoom: 3.5,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 320, 'text-field': ['get', 'id'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-letter-spacing': 0.06 },
      paint: { 'text-color': AIRWAY, 'text-opacity': 0.85, 'text-halo-color': 'rgba(10, 6, 14, 0.9)', 'text-halo-width': 1.2 },
    },
    before,
  )
  map.addLayer(
    {
      id: 'nat-tracks-line',
      type: 'line',
      source: NAT,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dirColor, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 1.5, 1, 6, 2.2] as unknown as ExpressionSpecification },
    },
    before,
  )
  map.addLayer(
    {
      id: 'nat-tracks-end',
      type: 'circle',
      source: NAT_ENDS,
      minzoom: 2,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 6, 6, 9] as unknown as ExpressionSpecification, 'circle-color': '#16141d', 'circle-stroke-color': dirColor, 'circle-stroke-width': 1.5 },
    },
    before,
  )
  map.addLayer(
    {
      id: 'nat-tracks-end-label',
      type: 'symbol',
      source: NAT_ENDS,
      minzoom: 2,
      layout: { 'text-field': ['get', 'id'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 12] as unknown as ExpressionSpecification, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': dirColor },
    },
    before,
  )
  await loadNat(map)
  clearInterval(natTimer)
  natTimer = window.setInterval(() => {
    if (map.getLayer('nat-tracks-line') && map.getLayoutProperty('nat-tracks-line', 'visibility') !== 'none') void loadNat(map)
  }, 30 * 60_000)
}

/** Show or hide the oceanic routes (loading them the first time). */
export function setOceanicVisible(map: MLMap, visible: boolean) {
  if (visible && !map.getLayer(LAYERS[0])) {
    loading ??= add(map).finally(() => (loading = null))
    return
  }
  for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
}
