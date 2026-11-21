import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl'
import { AIRPORT_LAYER } from './airports'

/**
 * Encyclopedia mode: each country's main airlines (up to 3) as a "logo stack"
 * at the country's label point. Logos come from Wikimedia Commons, downloaded
 * by the server and served locally (works offline); until a logo is there, the
 * airline's name is shown instead. Stacks are scaled by country size, and where
 * they'd overlap the bigger country wins (smaller ones appear as you zoom in).
 * Data: public/data/country-airlines.json (scripts/encyclopedia/build-countries.mjs).
 */

const SOURCE = 'country-airlines'
export const COUNTRY_AIRLINES_LAYER = 'country-airlines'
// Drawn at about the size it's shown at the default zoom (scaled only ~0.85-1.25x
// with zoom), at extra resolution for the screen, so text stays crisp.
const PX = Math.min(4, Math.ceil((window.devicePixelRatio || 1) * 1.5))
const SLOT_W = 50
const SLOT_H = 26
const GAP = 3
const PAD = 4

type Country = { iso: string; name: string; lon: number; lat: number; areaKm2: number; airlines: [string, string][] }
type LogoIndex = Record<string, { src: string }>

let loading: Promise<void> | null = null
let logos: LogoIndex = {}
const images = new Map<string, HTMLImageElement>()
let countries: Country[] = []
let refreshTimer = 0

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** The airline's name, shrunk (and split over two lines if needed) to fit a tile. */
function drawName(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, font: string) {
  const maxW = SLOT_W - 5
  for (let size = 10.5; size >= 7.5; size -= 0.5) {
    ctx.font = `600 ${size}px ${font}`
    if (ctx.measureText(name).width <= maxW) {
      ctx.fillText(name, x + SLOT_W / 2, y + SLOT_H / 2)
      return
    }
    // two lines, split at the space nearest the middle
    const words = name.split(' ')
    if (words.length > 1 && size <= 9) {
      let bestCut = 1
      let bestDiff = Infinity
      for (let i = 1; i < words.length; i++) {
        const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length)
        if (d < bestDiff) (bestDiff = d), (bestCut = i)
      }
      const l1 = words.slice(0, bestCut).join(' ')
      const l2 = words.slice(bestCut).join(' ')
      if (Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) <= maxW) {
        ctx.fillText(l1, x + SLOT_W / 2, y + SLOT_H / 2 - size * 0.55)
        ctx.fillText(l2, x + SLOT_W / 2, y + SLOT_H / 2 + size * 0.55)
        return
      }
    }
  }
  ctx.font = `600 7.5px ${font}`
  ctx.fillText(name.slice(0, 8) + '…', x + SLOT_W / 2, y + SLOT_H / 2)
}

function drawStack(c: Country, font: string): ImageData {
  const n = c.airlines.length
  const w = PAD * 2 + n * SLOT_W + (n - 1) * GAP
  const h = PAD * 2 + SLOT_H
  const canvas = document.createElement('canvas')
  canvas.width = w * PX
  canvas.height = h * PX
  const ctx = canvas.getContext('2d')!
  ctx.scale(PX, PX)
  // card
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8)
  ctx.fillStyle = 'rgba(22, 20, 29, 0.92)' // --panel-solid
  ctx.fill()
  ctx.strokeStyle = 'rgba(242, 198, 210, 0.35)' // --brand-soft, faint
  ctx.lineWidth = 1
  ctx.stroke()
  // tiles
  c.airlines.forEach(([code, name], i) => {
    const x = PAD + i * (SLOT_W + GAP)
    const y = PAD
    roundRect(ctx, x, y, SLOT_W, SLOT_H, 5)
    ctx.fillStyle = '#fbf7f8'
    ctx.fill()
    const img = images.get(code)
    if (img && img.naturalWidth) {
      const pad = 2.5
      const s = Math.min((SLOT_W - pad * 2) / img.naturalWidth, (SLOT_H - pad * 2) / img.naturalHeight)
      const iw = img.naturalWidth * s
      const ih = img.naturalHeight * s
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, x + (SLOT_W - iw) / 2, y + (SLOT_H - ih) / 2, iw, ih)
    } else {
      ctx.fillStyle = '#3d1426' // --brand-ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      drawName(ctx, name, x, y, font)
    }
  })
  return ctx.getImageData(0, 0, w * PX, h * PX)
}

/** Stack scale by land area: 0.8 for city-states up to 1 for large countries (kept readable). */
const sizeFor = (areaKm2: number) => Math.max(0.8, Math.min(1, 0.6 + 0.07 * Math.log10(Math.max(areaKm2, 10))))

function putImages(map: MLMap) {
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif'
  for (const c of countries) {
    const id = `ca-${c.iso}`
    const data = drawStack(c, font)
    if (map.hasImage(id)) map.updateImage(id, data)
    else map.addImage(id, data, { pixelRatio: PX })
  }
}

async function loadLogos(codes: string[]) {
  try {
    logos = await (await fetch('/api/media/airline-logos')).json()
  } catch {
    return 0 // offline and no server: names only
  }
  let added = 0
  await Promise.all(
    codes.map(async (code) => {
      if (images.has(code) || !logos[code]) return
      const img = await loadImage(logos[code].src)
      if (img) {
        images.set(code, img)
        added++
      }
    }),
  )
  return added
}

async function add(map: MLMap) {
  const res = await fetch('/data/country-airlines.json')
  countries = (await res.json()).countries
  const codes = [...new Set(countries.flatMap((c) => c.airlines.map((a) => a[0])))]
  await loadLogos(codes)
  putImages(map)
  if (!map.getSource(SOURCE))
    map.addSource(SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: countries.map((c) => ({
          type: 'Feature',
          properties: { iso: c.iso, name: c.name, k: sizeFor(c.areaKm2), rank: -c.areaKm2 },
          geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        })),
      },
      attribution: 'Airline logos: <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a> (logos are trademarks of their owners)',
    })
  if (!map.getLayer(COUNTRY_AIRLINES_LAYER))
    map.addLayer(
      {
        id: COUNTRY_AIRLINES_LAYER,
        type: 'symbol',
        source: SOURCE,
        minzoom: 1.7, // same as the airport pins
        layout: {
          'icon-image': ['concat', 'ca-', ['get', 'iso']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 1.7, ['*', 0.85, ['get', 'k']], 2.2, ['*', 0.95, ['get', 'k']], 4, ['*', 1.05, ['get', 'k']], 6, ['*', 1.25, ['get', 'k']]] as unknown as ExpressionSpecification,
          'icon-allow-overlap': false, // overlapping stacks: the bigger country is shown
          'icon-padding': 3,
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 1.7, 0, 2, 1] as unknown as ExpressionSpecification },
      },
      map.getLayer(AIRPORT_LAYER) ? AIRPORT_LAYER : undefined, // under the airport pins
    )
  // Logos still downloading on the server: look again every 2 minutes and swap them in.
  clearInterval(refreshTimer)
  refreshTimer = window.setInterval(async () => {
    if (codes.every((c) => images.has(c))) return clearInterval(refreshTimer)
    if (map.getLayer(COUNTRY_AIRLINES_LAYER) && map.getLayoutProperty(COUNTRY_AIRLINES_LAYER, 'visibility') !== 'none' && (await loadLogos(codes)) > 0) putImages(map)
  }, 120_000)
}

/** Show or hide the stacks (loading them the first time). */
export function setCountryAirlinesVisible(map: MLMap, visible: boolean) {
  if (visible && !map.getLayer(COUNTRY_AIRLINES_LAYER)) {
    loading ??= add(map).finally(() => (loading = null))
    return
  }
  if (map.getLayer(COUNTRY_AIRLINES_LAYER)) map.setLayoutProperty(COUNTRY_AIRLINES_LAYER, 'visibility', visible ? 'visible' : 'none')
}
