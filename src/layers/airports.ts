import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl'
import majorAirports from '../../data/major-airports.json'

/**
 * Pins for the world's 100 busiest airports (data/major-airports.json), drawn
 * above the aircraft. Visible at the default zoom (2.2) and slightly further
 * out, fading in from zoom 1.7; the IATA code appears beside the pin once zoomed in a little more.
 * Where pins would overlap, the busier airport wins. Clicking one opens its card.
 */

const SOURCE = 'major-airports'
export const AIRPORT_LAYER = 'major-airport-pins'
const ICON = 'airport-pin'
const PX = 2
const W = 26
const H = 34

const FILL = '#c8456b' // --brand
const RING = '#f4eef1' // --text
const GLYPH = '#ffffff'

function drawPin(): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = W * PX
  canvas.height = H * PX
  const ctx = canvas.getContext('2d')!
  ctx.scale(PX, PX)
  const cx = W / 2
  const cy = 12
  const r = 10.5

  // Teardrop: a circle that narrows to a point at the bottom.
  const tipY = H - 1.5
  const a = Math.asin(r / (tipY - cy)) // where the sides leave the circle
  ctx.beginPath()
  ctx.moveTo(cx, tipY)
  ctx.arc(cx, cy, r, Math.PI / 2 + a, Math.PI / 2 - a)
  ctx.closePath()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 1
  ctx.fillStyle = FILL
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 1.6
  ctx.strokeStyle = RING
  ctx.stroke()

  // Control tower.
  ctx.fillStyle = GLYPH
  ctx.strokeStyle = GLYPH
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.3
  ctx.beginPath() // antenna
  ctx.moveTo(cx, 3.4)
  ctx.lineTo(cx, 5.4)
  ctx.stroke()
  ctx.beginPath() // cab (wider at the top, like a real tower)
  ctx.moveTo(cx - 5.4, 5.6)
  ctx.lineTo(cx + 5.4, 5.6)
  ctx.lineTo(cx + 4, 10)
  ctx.lineTo(cx - 4, 10)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = FILL // windows
  ctx.fillRect(cx - 3.3, 7.1, 6.6, 1.3)
  ctx.fillStyle = GLYPH
  ctx.fillRect(cx - 1.6, 10, 3.2, 7.4) // shaft
  ctx.beginPath() // base
  ctx.moveTo(cx - 4.6, 18.2)
  ctx.lineTo(cx + 4.6, 18.2)
  ctx.stroke()
  return ctx.getImageData(0, 0, W * PX, H * PX)
}

export type MajorAirport = [icao: string, iata: string, name: string, city: string, country: string, lat: number, lon: number, rank: number, tz: string]
export const MAJOR_AIRPORTS = majorAirports.airports as MajorAirport[]
export const majorAirport = (icao: string) => MAJOR_AIRPORTS.find((a) => a[0] === icao)

function geojson() {
  return {
    type: 'FeatureCollection' as const,
    features: MAJOR_AIRPORTS.map(([icao, iata, , , , lat, lon, rank]) => ({
      type: 'Feature' as const,
      properties: { icao, iata, rank },
      geometry: { type: 'Point' as const, coordinates: [lon, lat] },
    })),
  }
}

/** Add the pins (on top of everything else unless `beforeLayer` is given). */
export function addAirportLayer(map: MLMap, beforeLayer?: string) {
  if (!map.hasImage(ICON)) map.addImage(ICON, drawPin(), { pixelRatio: PX })
  if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', data: geojson() })
  if (map.getLayer(AIRPORT_LAYER)) return
  // Visible at the default zoom (2.2) and a little further out; gone below 1.7.
  const fadeIn = ['interpolate', ['linear'], ['zoom'], 1.7, 0, 2, 1] as unknown as ExpressionSpecification
  map.addLayer(
    {
      id: AIRPORT_LAYER,
      type: 'symbol',
      source: SOURCE,
      minzoom: 1.7,
      layout: {
        'icon-image': ICON,
        'icon-anchor': 'bottom',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 1.7, 0.45, 2.2, 0.5, 4, 0.65, 6, 0.8, 9, 0.95] as unknown as ExpressionSpecification,
        'icon-allow-overlap': false, // overlapping pins: the busier airport is shown
        'icon-ignore-placement': true, // ...without hiding the map's own labels
        'symbol-sort-key': ['get', 'rank'],
        'text-field': ['step', ['zoom'], '', 5.5, ['get', 'iata']] as unknown as ExpressionSpecification,
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-anchor': 'left',
        'text-offset': [0.9, -1.25],
        'text-optional': true,
        'text-allow-overlap': false,
      },
      paint: {
        'icon-opacity': fadeIn,
        'text-color': '#f2c6d2', // --brand-soft
        'text-halo-color': 'rgba(10, 6, 14, 0.9)',
        'text-halo-width': 1.4,
        'text-opacity': fadeIn,
      },
    },
    beforeLayer,
  )
}

/** Show or hide the pins. */
export function setAirportsVisible(map: MLMap, visible: boolean) {
  if (map.getLayer(AIRPORT_LAYER)) map.setLayoutProperty(AIRPORT_LAYER, 'visibility', visible ? 'visible' : 'none')
}
