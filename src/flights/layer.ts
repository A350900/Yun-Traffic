import type { ExpressionSpecification, GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { F, type AircraftTuple } from '../../shared/wire'
import { addAircraftIcons, ICON } from './icons'
import { extrapolate } from './position'
import type { AircraftMap } from './feed'

export const SOURCE = 'aircraft'
export const LAYER = 'aircraft-icons'
const SELECTED_LAYER = 'aircraft-selected'
const LABEL_LAYER = 'aircraft-labels'

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

/**
 * Build a GeoJSON FeatureCollection with positions projected to `now`.
 * Properties are kept minimal: MapLibre copies every object to its worker,
 * and that copy is the most expensive part of an update.
 */
export function buildFeatures(aircraft: AircraftMap, now: number, view: ViewWindow | null, keep: string | null): FeatureCollection {
  const features: Feature[] = []
  for (const ac of aircraft.values()) {
    if (isSurfaceVehicle(ac)) continue
    const pos = extrapolate(ac, now)
    if (view && ac[F.Hex] !== keep) {
      const dLon = ((pos[0] - view.centerLon + 540) % 360) - 180
      if (dLon > view.halfLon || dLon < -view.halfLon || pos[1] < view.south || pos[1] > view.north) continue
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pos },
      properties: {
        hex: ac[F.Hex],
        rot: Math.round(ac[F.Track] ?? 0),
        icon: iconFor(ac),
        s: sizeFor(ac),
        cs: ac[F.Callsign] ?? ac[F.Registration] ?? '',
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

// Icons shrink when zoomed out so 10k+ aircraft on a world view stay readable.
const iconSize = (scale: number) => [
  'interpolate', ['linear'], ['zoom'],
  1, ['*', 0.42 * scale, ['get', 's']],
  4, ['*', 0.62 * scale, ['get', 's']],
  8, ['*', 0.95 * scale, ['get', 's']],
  12, ['*', 1.35 * scale, ['get', 's']],
] as unknown as ExpressionSpecification

export function addAircraftLayers(map: MLMap) {
  addAircraftIcons(map)
  if (map.getSource(SOURCE)) return

  map.addSource(SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    // Aircraft are points only; skip work GeoJSON sources do for lines/polygons.
    // Tiles above z8 are overzoomed (still ~20 m precision), which keeps re-tiling cheap.
    tolerance: 0,
    buffer: 32,
    maxzoom: 8,
  })

  map.addLayer({
    id: LAYER,
    type: 'symbol',
    source: SOURCE,
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
  })

  map.addLayer({
    id: LABEL_LAYER,
    type: 'symbol',
    source: SOURCE,
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

  map.addLayer({
    id: SELECTED_LAYER,
    type: 'symbol',
    source: SOURCE,
    filter: ['==', ['get', 'hex'], ''],
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

export function setSelected(map: MLMap, hex: string | null) {
  if (map.getLayer(SELECTED_LAYER)) map.setFilter(SELECTED_LAYER, ['==', ['get', 'hex'], hex ?? ''])
}

export function updateAircraftSource(map: MLMap, aircraft: AircraftMap, now: number, view: ViewWindow | null, keep: string | null) {
  const src = map.getSource(SOURCE) as GeoJSONSource | undefined
  if (!src) return { ms: 0, sent: 0 }
  const t0 = performance.now()
  const data = buildFeatures(aircraft, now, view, keep)
  src.setData(data)
  return { ms: performance.now() - t0, sent: data.features.length }
}
