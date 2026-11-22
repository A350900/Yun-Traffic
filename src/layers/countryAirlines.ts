import { Popup, type ExpressionSpecification, type Map as MLMap } from 'maplibre-gl'
import { AIRPORT_LAYER } from './airports'

/**
 * Encyclopedia mode: each country's main airlines (up to 3) as overlapping
 * round badges (like a stack of coins, #1 in front) at the country's label point. Logos come from Wikimedia Commons, downloaded
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
/** badge diameter (logical px at the default zoom) */
const D = 34
/** how far each badge sits to the right of the one in front (fraction of D) */
const STEP = 0.74
/** room around the badges for the separating ring and shadow */
const M = 3

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

function drawStack(c: Country, font: string): ImageData {
  const n = c.airlines.length
  const w = M * 2 + D + (n - 1) * D * STEP
  const h = M * 2 + D
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * PX)
  canvas.height = Math.ceil(h * PX)
  const ctx = canvas.getContext('2d')!
  ctx.scale(PX, PX)
  const r = D / 2
  const inner = r - 1.6
  // Back to front: #3 (right), #2, then #1 (left) on top.
  for (let i = n - 1; i >= 0; i--) {
    const [code] = c.airlines[i]
    const cx = M + r + i * D * STEP
    const cy = M + r
    // shadow + dark ring that separates the overlapping badges
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 3
    ctx.shadowOffsetY = 1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#16141d' // --panel-solid
    ctx.fill()
    ctx.restore()
    // badge
    ctx.beginPath()
    ctx.arc(cx, cy, inner, 0, Math.PI * 2)
    ctx.fillStyle = '#fbf7f8'
    ctx.fill()
    // Badges behind another one are partly covered on the left: use the visible part.
    const covered = i > 0 ? D * (1 - STEP) : 0
    const img = images.get(code)
    if (img && img.naturalWidth) {
      // The largest rectangle of the logo's shape that fits in the circle (wide
      // wordmarks get the full width), minus what's covered, with a margin.
      const a = img.naturalWidth / img.naturalHeight
      const k = 0.86 / Math.sqrt(1 + a * a)
      let iw = 2 * inner * a * k
      let ih = 2 * inner * k
      if (covered) {
        const shrink = Math.max(0, iw - (2 * inner * 0.86 - covered)) / iw
        iw *= 1 - shrink
        ih *= 1 - shrink
      }
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, inner, 0, Math.PI * 2)
      ctx.clip()
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, cx + covered / 2 - iw / 2, cy - ih / 2, iw, ih)
      ctx.restore()
    } else {
      // no logo yet: the ICAO code, in the visible part of the badge
      ctx.fillStyle = '#3d1426' // --brand-ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 ${covered ? 9 : 10}px ${font}`
      ctx.fillText(code, cx + covered / 2, cy + 0.5)
    }
    // faint outer ring in the brand colour
    ctx.beginPath()
    ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(242, 198, 210, 0.45)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
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
  if (!visible) collapseStack()
}

// ---------------------------------------------------------------- expanded stack (click)

let popup: Popup | null = null

const countryName = (iso: string, fallback: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(iso) ?? fallback
  } catch {
    return fallback
  }
}

/** Grow a country's stack into a card listing its airlines (click a stack). */
export function expandStack(map: MLMap, iso: string) {
  const c = countries.find((x) => x.iso === iso)
  if (!c) return
  popup?.remove()
  const el = document.createElement('div')
  el.className = 'stack-card'
  const head = document.createElement('header')
  const title = document.createElement('h3')
  title.textContent = countryName(c.iso, c.name)
  const sub = document.createElement('span')
  sub.textContent = c.airlines.length === 1 ? 'Main airline' : `Top ${c.airlines.length} airlines`
  const close = document.createElement('button')
  close.className = 'stack-close'
  close.setAttribute('aria-label', 'Close')
  close.textContent = '×'
  close.onclick = () => popup?.remove()
  const titles = document.createElement('div')
  titles.append(title, sub)
  head.append(titles, close)
  const list = document.createElement('ol')
  c.airlines.forEach(([code, name], i) => {
    const li = document.createElement('li')
    const rank = document.createElement('span')
    rank.className = 'stack-rank'
    rank.textContent = String(i + 1)
    const tile = document.createElement('span')
    tile.className = 'stack-tile'
    const img = images.get(code)
    if (img) {
      const im = document.createElement('img')
      im.src = img.src
      im.alt = `${name} logo`
      tile.append(im)
    } else {
      tile.classList.add('text')
      tile.textContent = name
    }
    const info = document.createElement('span')
    info.className = 'stack-info'
    const n = document.createElement('strong')
    n.textContent = name
    const meta = document.createElement('small')
    meta.textContent = code
    info.append(n, meta)
    li.append(rank, tile, info)
    list.append(li)
  })
  const credit = document.createElement('footer')
  credit.textContent = c.airlines.some(([code]) => images.has(code)) ? 'Logos: Wikimedia Commons (trademarks of their owners)' : 'Logos not downloaded yet'
  el.append(head, list, credit)

  popup = new Popup({ anchor: 'center', closeButton: false, closeOnClick: true, maxWidth: 'none', className: 'stack-popup' })
    .setLngLat([c.lon, c.lat])
    .setDOMContent(el)
    .addTo(map)
  const p = popup
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.remove()
  window.addEventListener('keydown', onKey)
  p.on('close', () => {
    window.removeEventListener('keydown', onKey)
    if (popup === p) popup = null
  })
}

/** Close an expanded stack (e.g. when the layer is hidden). */
export function collapseStack() {
  popup?.remove()
}
