import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import type { FlightInfo, FlightTrace } from '../../shared/wire'
import { distanceKm, greatCircle } from './geo'

/**
 * Lines for the selected flight:
 *   - the path already flown, coloured by altitude
 *   - a dashed line from the departure airport to the first known position,
 *     when tracking began after takeoff
 *   - a dashed great-circle line from the aircraft to its destination
 *   - the departure and arrival airports, labelled
 */

const FLOWN = 'path-flown'
const REMAINING = 'path-remaining'
const AIRPORTS = 'path-airports'

/** Altitude colour scale (feet). Also used for the legend in the panel. */
export const ALTITUDE_STOPS: [number, string][] = [
  [0, '#5be3a6'],
  [10_000, '#3fc1f0'],
  [20_000, '#4d7cff'],
  [30_000, '#a45cff'],
  [40_000, '#ff6fae'],
]

const altitudeColor = ['interpolate', ['linear'], ['get', 'alt'], ...ALTITUDE_STOPS.flat()] as unknown as ExpressionSpecification
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function addPathLayers(map: MLMap, beforeId: string) {
  if (map.getSource(FLOWN)) return
  for (const id of [FLOWN, REMAINING, AIRPORTS]) map.addSource(id, { type: 'geojson', data: empty })

  map.addLayer(
    {
      id: REMAINING,
      type: 'line',
      source: REMAINING,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#f2c6d2', 'line-opacity': 0.75, 'line-width': 1.6, 'line-dasharray': [2, 2.5] },
    },
    beforeId,
  )
  // A dark casing under the flown path so it reads on any background.
  map.addLayer(
    {
      id: `${FLOWN}-casing`,
      type: 'line',
      source: FLOWN,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': 'rgba(10, 6, 14, 0.7)', 'line-width': 5 },
    },
    beforeId,
  )
  map.addLayer(
    {
      id: FLOWN,
      type: 'line',
      source: FLOWN,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': altitudeColor, 'line-width': 2.6 },
    },
    beforeId,
  )
  map.addLayer(
    {
      id: AIRPORTS,
      type: 'circle',
      source: AIRPORTS,
      paint: {
        'circle-radius': 5,
        'circle-color': '#121016',
        'circle-stroke-color': '#f2c6d2',
        'circle-stroke-width': 2,
      },
    },
    beforeId,
  )
  map.addLayer({
    id: `${AIRPORTS}-label`,
    type: 'symbol',
    source: AIRPORTS,
    layout: {
      'text-field': ['get', 'code'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#f4eef1', 'text-halo-color': 'rgba(10, 6, 14, 0.9)', 'text-halo-width': 1.5 },
  })
}

const set = (map: MLMap, id: string, data: FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data)

export function clearPath(map: MLMap) {
  for (const id of [FLOWN, REMAINING, AIRPORTS]) set(map, id, empty)
}

/** Bucket altitudes so the path is a few dozen coloured runs, not hundreds of segments. */
const bucket = (alt: number) => (alt < 0 ? 0 : Math.round(alt / 1000) * 1000)

/**
 * Redraw the selected flight's lines. `live` is the aircraft's current
 * (extrapolated) position and altitude, so the path always reaches the icon.
 */
export function updatePath(map: MLMap, trace: FlightTrace | null, info: FlightInfo | null, live: { lon: number; lat: number; alt: number } | null) {
  // --- flown path. Points: [lon, lat, alt]
  const pts: [number, number, number][] = (trace?.points ?? []).map((p) => [p[2], p[1], p[3]])
  if (live) pts.push([live.lon, live.lat, live.alt])
  // Unwrap longitudes so a flight crossing the antimeridian is drawn continuously.
  for (let i = 1; i < pts.length; i++) {
    while (pts[i][0] - pts[i - 1][0] > 180) pts[i][0] -= 360
    while (pts[i][0] - pts[i - 1][0] < -180) pts[i][0] += 360
  }
  const runs: Feature[] = []
  let run: [number, number][] = []
  let runAlt = -1
  const endRun = () => {
    if (run.length > 1) runs.push({ type: 'Feature', properties: { alt: runAlt }, geometry: { type: 'LineString', coordinates: run } })
    run = []
  }
  for (let i = 0; i < pts.length; i++) {
    const [lon, lat, alt] = pts[i]
    const b = bucket(alt)
    if (run.length && b !== runAlt) {
      run.push([lon, lat]) // overlap one point so runs join seamlessly
      endRun()
    }
    if (!run.length) runAlt = b
    run.push([lon, lat])
  }
  endRun()
  set(map, FLOWN, { type: 'FeatureCollection', features: runs })

  // --- remaining (dashed) and airports
  const route = info?.route && info.route.plausible ? info.route : null
  const remaining: Feature[] = []
  const airports: Feature[] = []
  if (route) {
    const dest = route.destination
    const from = pts.length ? pts[pts.length - 1] : [route.origin.lon, route.origin.lat]
    const line = greatCircle(from[1], ((from[0] + 540) % 360) - 180, dest.lat, dest.lon, from[0])
    remaining.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } })
    const endLon = line[line.length - 1][0]
    // Put the origin marker on the same "copy" of the world as the start of the path.
    let startLon = route.origin.lon
    if (pts.length) {
      while (startLon - pts[0][0] > 180) startLon -= 360
      while (startLon - pts[0][0] < -180) startLon += 360
    }
    // Tracking began after takeoff: the first part of the flight is unknown.
    const first = trace?.points[0]
    if (first && first[3] !== -1 && pts.length && distanceKm(route.origin.lat, route.origin.lon, first[1], first[2]) > 10) {
      remaining.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: greatCircle(route.origin.lat, startLon, first[1], pts[0][0], startLon) },
      })
    }
    airports.push(
      { type: 'Feature', properties: { code: route.origin.iata ?? route.origin.icao }, geometry: { type: 'Point', coordinates: [startLon, route.origin.lat] } },
      { type: 'Feature', properties: { code: dest.iata ?? dest.icao }, geometry: { type: 'Point', coordinates: [endLon, dest.lat] } },
    )
  }
  set(map, REMAINING, { type: 'FeatureCollection', features: remaining })
  set(map, AIRPORTS, { type: 'FeatureCollection', features: airports })
}
