import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import { F, type AircraftTuple } from '../../shared/wire'
import { addAircraftIcons, ICON } from './icons'
import { ESTIMATED_AFTER_MS, extrapolate } from './position'
import type { AircraftMap } from './feed'

/**
 * Aircraft are split into BANDS groups (by ICAO address), each with its own
 * source and layers. Updating one group at a time spreads MapLibre's work
 * into small pieces (~15 ms) instead of one big pause per update; with
 * 14k+ aircraft a single source caused a ~60 ms stall every redraw.
 */
export const BANDS = 8
const sourceId = (b: number) => `aircraft-${b}`
const iconLayerId = (b: number) => `aircraft-icons-${b}`
const labelLayerId = (b: number) => `aircraft-labels-${b}`
/** Icon layers, for click handling. */
export const ICON_LAYERS = Array.from({ length: BANDS }, (_, b) => iconLayerId(b))
const SELECTED_SOURCE = 'aircraft-selected'

/** Which group an aircraft belongs to (stable: based on its ICAO address). */
export const bandOf = (hex: string) => parseInt(hex.slice(-2), 16) % BANDS || 0

const HEAVY = /^(A3[3-5]|A38|B74|B77|B78|A30|A31|MD11|DC10|IL96|C17|C5|A400|B76|K35)/

/** Relative icon size by ADS-B emitter category (falls back to type). */
function sizeFor(ac: AircraftTuple): number {
  switch (ac[F.Category]) {
    case 'A1': return 0.62 // light (< 15,500 lb)
    case 'A2': return 0.75 // small
    case 'A3': return 0.92 // large (most airliners)
    case 'A4': return 1 // high-vortex large (B757)
    case 'A5': return 1.15 // heavy
    case 'A6': return 0.8 // high performance
    case 'A7': return 0.85 // rotorcraft
    case 'B1': case 'B2': case 'B4': return 0.6 // glider, balloon, ultralight
    case 'B6': return 0.5 // UAV
  }
  const type = ac[F.Type]
  if (type && HEAVY.test(type)) return 1.15
  return 0.9
}

/** Ground vehicles and fixed obstacles also transmit ADS-B; we don't draw them. */
const isSurfaceVehicle = (ac: AircraftTuple) => ac[F.Category]?.startsWith('C') ?? false
const isHeli = (ac: AircraftTuple) => ac[F.Category] === 'A7'

function iconFor(ac: AircraftTuple) {
  const ground = ac[F.Alt] === -1
  if (isHeli(ac)) return ground ? ICON.heliGround : ICON.heliAir
  return ground ? ICON.ground : ICON.air
}

/** Area to include when zoomed in; aircraft outside it aren't sent to the map. */
export interface ViewWindow {
  centerLon: number
  /** Half-width in degrees of longitude (handles the antimeridian) */
  halfLon: number
  south: number
  north: number
}

// Icons shrink when zoomed out, so 10k+ aircraft on a world view read as real
// traffic density instead of merging into solid blobs. Shared with the
// simulated-traffic layer so both look alike.
export const ICON_SIZE_STOPS: [zoom: number, factor: number][] = [
  [1, 0.26],
  [2, 0.32],
  [3, 0.4],
  [4, 0.52],
  [6, 0.75],
  [8, 0.95],
  [12, 1.35],
]
const iconSize = (scale: number) =>
  ['interpolate', ['linear'], ['zoom'], ...ICON_SIZE_STOPS.flatMap(([z, f]) => [z, ['*', f * scale, ['get', 's']]])] as unknown as ExpressionSpecification

export function addAircraftLayers(map: MLMap) {
  addAircraftIcons(map)
  if (map.getSource(sourceId(0))) return
  const empty = { type: 'FeatureCollection' as const, features: [] }

  for (let b = 0; b < BANDS; b++) {
    map.addSource(sourceId(b), {
      type: 'geojson',
      data: empty,
      // Points only; maxzoom 12 keeps positions precise to ~1 m at airport zoom
      // (deeper tiles are only built on demand).
      tolerance: 0,
      buffer: 32,
      maxzoom: 12,
    })
    map.addLayer({
      id: iconLayerId(b),
      type: 'symbol',
      source: sourceId(b),
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': iconSize(1),
        'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        // Always draw every aircraft: no collision detection, which is also
        // what keeps placement cheap at 10k+ symbols.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 's'],
      },
      paint: {
        // Estimated positions are drawn faded so they read as "probably here".
        'icon-opacity': ['case', ['get', 'e'], 0.5, 1],
      },
    })
  }
  // Labels after all icons so they're never hidden under another group's icons.
  for (let b = 0; b < BANDS; b++) {
    map.addLayer({
      id: labelLayerId(b),
      type: 'symbol',
      source: sourceId(b),
      minzoom: 6.5,
      layout: {
        'text-field': ['get', 'cs'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-optional': true,
        'text-padding': 4,
      },
      paint: {
        'text-color': '#f2c6d2',
        'text-halo-color': 'rgba(10, 6, 14, 0.9)',
        'text-halo-width': 1.4,
      },
    })
  }

  // The selected aircraft: its own one-feature source, drawn on top.
  map.addSource(SELECTED_SOURCE, { type: 'geojson', data: empty })
  map.addLayer({
    id: SELECTED_SOURCE,
    type: 'symbol',
    source: SELECTED_SOURCE,
    layout: {
      'icon-image': ['case', ['in', 'heli', ['get', 'icon']], ICON.heliSelected, ICON.selected],
      'icon-size': iconSize(1.35),
      'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
}

/** Move the highlight to the selected aircraft's current position (cheap: one feature). */
export function updateSelected(map: MLMap, ac: AircraftTuple | undefined, now: number) {
  const src = map.getSource(SELECTED_SOURCE) as GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: 'FeatureCollection',
    features: ac
      ? [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: extrapolate(ac, now) },
            properties: { icon: iconFor(ac), rot: Math.round(ac[F.Track] ?? 0), s: sizeFor(ac) },
          },
        ]
      : [],
  })
}

const blobUrls: (string | null)[] = Array(BANDS).fill(null)

/**
 * Send one group of aircraft to the map. Instead of handing MapLibre a
 * JavaScript object (which it copies to its worker key by key), we write the
 * GeoJSON text directly and give MapLibre a temporary in-memory URL; its
 * worker fetches and parses it off the main thread.
 */
export function updateAircraftBand(
  map: MLMap,
  band: number,
  aircraft: AircraftMap,
  now: number,
  view: ViewWindow | null,
  /** How many groups are in use: 1 when zoomed in (few aircraft), BANDS when zoomed out. */
  groups: number,
) {
  const src = map.getSource(sourceId(band)) as GeoJSONSource | undefined
  if (!src) return 0
  const parts: string[] = []
  for (const ac of band < groups ? aircraft.values() : []) {
    if ((groups > 1 && bandOf(ac[F.Hex]) !== band) || isSurfaceVehicle(ac)) continue
    const pos = extrapolate(ac, now)
    if (view) {
      const dLon = ((pos[0] - view.centerLon + 540) % 360) - 180
      if (dLon > view.halfLon || dLon < -view.halfLon || pos[1] < view.south || pos[1] > view.north) continue
    }
    const cs = ac[F.Callsign] ?? ac[F.Registration] ?? ''
    parts.push(
      `{"type":"Feature","geometry":{"type":"Point","coordinates":[${pos[0].toFixed(5)},${pos[1].toFixed(5)}]},` +
        `"properties":{"hex":${JSON.stringify(ac[F.Hex])},"rot":${Math.round(ac[F.Track] ?? 0)},"icon":"${iconFor(ac)}",` +
        `"s":${sizeFor(ac)},"cs":${JSON.stringify(cs)},"e":${now - ac[F.PosTime] > ESTIMATED_AFTER_MS}}}`,
    )
  }
  const url = URL.createObjectURL(new Blob([`{"type":"FeatureCollection","features":[${parts.join(',')}]}`], { type: 'application/json' }))
  src.setData(url)
  // Free the previous snapshot once the map has had time to read the new one.
  const old = blobUrls[band]
  blobUrls[band] = url
  if (old) setTimeout(() => URL.revokeObjectURL(old), 10_000)
  return parts.length
}
