import { Popup, type ExpressionSpecification, type Map as MLMap } from 'maplibre-gl'
import { AIRPORT_LAYER } from './airports'

/**
 * Encyclopedia mode: each country's main airlines (up to 3) at the country's
 * label point, as their logos in one light colour with a dark glow, #1 larger
 * on top. Logos: your own in logos/<ICAO>.png, else from Wikimedia Commons,
 * downloaded by the server and served locally (works offline); without one,
 * the airline's name is written in the same style.
 * Clicking opens a card with the full-colour logos. Scaled by country size;
 * where they'd overlap the country with more air traffic wins (others appear on zoom).
 * Data: public/data/country-airlines.json (scripts/encyclopedia/build-countries.mjs).
 */

const SOURCE = 'country-airlines'
export const COUNTRY_AIRLINES_LAYER = 'country-airlines'
/** priority countries (small countries with big airlines) get their own layer on top: a higher layer is
 *  placed first across all tiles, so they always win over neighbours (sort keys only work within a tile) */
const PRIORITY_LAYER = 'country-airlines-priority'
export const COUNTRY_AIRLINES_LAYERS = [COUNTRY_AIRLINES_LAYER, PRIORITY_LAYER]
// Drawn at about the size it's shown at the default zoom (scaled only ~0.85-1.25x
// with zoom), at extra resolution for the screen, so text stays crisp.
const PX = Math.min(4, Math.ceil((window.devicePixelRatio || 1) * 1.5))
/** box for the #1 airline, and for #2/#3 (logical px at the default zoom) */
const W1 = 92
const H1 = 21
const W2 = 70
const H2 = 15
const GAP = 5
/** room around the text for the glow */
const PAD = 6
const INK_1 = '#fbf3f6'
const INK_2 = '#e9d3da'
const GLOW = 'rgba(8, 5, 12, 0.95)'

type Country = { iso: string; name: string; lon: number; lat: number; areaKm2: number; routes?: number; airlines: [string, string][]; priority?: boolean; anchor?: string }
/** per airline: full logo, as served by our server */
type LogoIndex = Record<string, { logo?: string; icon?: string }>

let loading: Promise<void> | null = null
let logos: LogoIndex = {}
/** full logos (expanded card) */
const images = new Map<string, HTMLImageElement>()
/** each logo as an alpha mask (trimmed, background removed), for the monochrome style */
const marks = new Map<string, HTMLCanvasElement | null>()
const tinted = new Map<string, HTMLCanvasElement>()
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

/** A logo in one colour. */
function tint(code: string, mark: HTMLCanvasElement, color: string) {
  const key = `${code}|${color}`
  let c = tinted.get(key)
  if (!c) {
    c = document.createElement('canvas')
    c.width = mark.width
    c.height = mark.height
    const x = c.getContext('2d')!
    x.drawImage(mark, 0, 0)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = color
    x.fillRect(0, 0, c.width, c.height)
    tinted.set(key, c)
  }
  return c
}

function drawStack(c: Country, font: string): ImageData {
  const n = c.airlines.length
  // Measure first: the stack is only as wide as its widest airline (narrower
  // boxes collide less, so more countries fit where it's crowded).
  const m = document.createElement('canvas').getContext('2d')!
  const rows = c.airlines.map(([code, name], i) => {
    const W = i ? W2 : W1
    const H = i ? H2 : H1
    const mark = marks.get(code)
    if (mark) {
      const s = Math.min(W / mark.width, H / mark.height)
      return { code, name, i, H, mark, w: mark.width * s, h: mark.height * s, size: 0 }
    }
    let size = i ? 10.5 : 13
    m.font = `600 ${size}px ${font}`
    while (size > 7.5 && m.measureText(name).width > W + 14) m.font = `600 ${(size -= 0.5)}px ${font}`
    return { code, name, i, H, mark: null, w: m.measureText(name).width, h: H, size }
  })
  const contentW = Math.max(...rows.map((r) => r.w))
  const w = PAD * 2 + contentW
  const h = PAD * 2 + H1 + (n - 1) * (H2 + GAP)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * PX)
  canvas.height = Math.ceil(h * PX)
  const ctx = canvas.getContext('2d')!
  ctx.scale(PX, PX)
  ctx.imageSmoothingQuality = 'high'
  for (const r of rows) {
    const y = PAD + (r.i ? H1 + GAP + (r.i - 1) * (H2 + GAP) : 0)
    const color = r.i ? INK_2 : INK_1
    ctx.save()
    ctx.shadowColor = GLOW
    ctx.shadowBlur = 5
    if (r.mark) {
      const t = tint(r.code, r.mark, color)
      // twice: a stronger glow keeps light text readable over light map areas
      for (let k = 0; k < 2; k++) ctx.drawImage(t, (w - r.w) / 2, y + (r.H - r.h) / 2, r.w, r.h)
    } else {
      // no logo yet: the airline's name in the same style
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `600 ${r.size}px ${font}`
      for (let k = 0; k < 2; k++) ctx.fillText(r.name, w / 2, y + r.H / 2 + 0.5)
    }
    ctx.restore()
  }
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Stack scale by land area: 0.8 for city-states up to 1 for large countries (kept readable). */
const sizeFor = (areaKm2: number) => Math.max(0.8, Math.min(1, 0.6 + 0.07 * Math.log10(Math.max(areaKm2, 10))))

/** In Europe (too crowded for three at world zoom), only each country's #1 airline is shown below this zoom. */
const FULL_FROM_ZOOM = 3
/** Countries treated as Europe for that (by their point): lon -25..45, lat 34..72. */
const inEurope = (c: Country) => c.lon > -25 && c.lon < 45 && c.lat > 34 && c.lat < 72

function putImages(map: MLMap) {
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const put = (id: string, data: ImageData) => (map.hasImage(id) ? map.updateImage(id, data) : map.addImage(id, data, { pixelRatio: PX }))
  for (const c of countries) {
    put(`ca-${c.iso}`, drawStack(c, font))
    put(`ca1-${c.iso}`, drawStack({ ...c, airlines: c.airlines.slice(0, 1) }, font))
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
      const src = logos[code]?.logo
      if (!src || images.has(code)) return
      const img = await loadImage(src)
      if (!img) return
      images.set(code, img)
      marks.set(code, logoMask(img))
      added++
    }),
  )
  return added
}

/**
 * A logo as a mask for the monochrome style: the whole logo (symbol and text),
 * trimmed to its edges so every logo sits at a consistent size, with any solid
 * background removed ("ink" is what isn't transparent or the background colour
 * in the corner). Recoloured when drawn. null if the image is empty.
 */
function logoMask(img: HTMLImageElement): HTMLCanvasElement | null {
  // Work on a rendered copy (~800 px wide; SVGs are drawn whole, then cropped).
  const scale = Math.min(4, 800 / img.naturalWidth)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  // background: transparent, or the colour of the top-left corner if opaque
  const bg = px[3] > 200 ? [px[0], px[1], px[2]] : null
  const inkAt = (i: number) =>
    px[i + 3] > 60 && (!bg || Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 60)
  let x0 = w, x1 = -1, y0 = h, y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (inkAt((y * w + x) * 4)) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < x0) return null
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const out = document.createElement('canvas')
  out.width = bw
  out.height = bh
  const o = out.getContext('2d')!
  const m = o.createImageData(bw, bh)
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = ((y0 + y) * w + x0 + x) * 4
      const j = (y * bw + x) * 4
      m.data[j] = m.data[j + 1] = m.data[j + 2] = 255
      m.data[j + 3] = inkAt(i) ? (bg ? 255 : px[i + 3]) : 0
    }
  o.putImageData(m, 0, 0)
  return out
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
          // overlaps: priority countries first (own layer), then the country with more air traffic
          properties: { iso: c.iso, name: c.name, k: sizeFor(c.areaKm2), rank: -(c.routes ?? 0), priority: Boolean(c.priority), anchor: c.anchor ?? 'center', compact: inEurope(c) },
          geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        })),
      },
      attribution: 'Airline logos: <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a> (logos are trademarks of their owners)',
    })
  const below = map.getLayer(AIRPORT_LAYER) ? AIRPORT_LAYER : undefined // under the airport pins
  for (const [id, priority] of [[COUNTRY_AIRLINES_LAYER, false], [PRIORITY_LAYER, true]] as const)
    if (!map.getLayer(id))
      map.addLayer(
        {
          id,
          type: 'symbol',
          source: SOURCE,
          filter: priority ? ['get', 'priority'] : ['!', ['get', 'priority']],
          minzoom: 1.7, // same as the airport pins
          layout: {
            // Europe zoomed out: #1 airline only; elsewhere, and from FULL_FROM_ZOOM: all (up to 3)
            'icon-image': ['step', ['zoom'], ['case', ['get', 'compact'], ['concat', 'ca1-', ['get', 'iso']], ['concat', 'ca-', ['get', 'iso']]], FULL_FROM_ZOOM, ['concat', 'ca-', ['get', 'iso']]] as unknown as ExpressionSpecification,
            // neighbours that would overlap sit to one side of their point (data: anchors)
            'icon-anchor': ['get', 'anchor'] as unknown as ExpressionSpecification,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 1.7, ['*', 0.85, ['get', 'k']], 2.2, ['*', 0.95, ['get', 'k']], 4, ['*', 1.05, ['get', 'k']], 6, ['*', 1.25, ['get', 'k']]] as unknown as ExpressionSpecification,
            // Priority stacks are always drawn (e.g. Hong Kong next to the HKG airport label) and
            // still keep their space, so neighbours like Macau give way; others: more air traffic wins.
            'icon-allow-overlap': priority,
            'icon-padding': 3,
            'symbol-sort-key': ['get', 'rank'],
          },
          paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 1.7, 0, 2, 1] as unknown as ExpressionSpecification },
        },
        below, // the priority layer is added second, so it sits above the normal one
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
  for (const id of COUNTRY_AIRLINES_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
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
    // full-colour logo here (the map shows only its text part, in one colour)
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
