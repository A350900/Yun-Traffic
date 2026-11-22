import { Popup, type ExpressionSpecification, type Map as MLMap } from 'maplibre-gl'
import { AIRPORT_LAYER } from './airports'

/**
 * Encyclopedia mode: each country's main airlines (up to 3) at the country's
 * label point, as the text part of their logos (the wordmark, without the
 * symbol) in one light colour with a dark glow, #1 larger on top. Logos come
 * from Wikimedia Commons, downloaded by the server and served locally (works
 * offline); without one, the airline's name is written in the same style.
 * Clicking opens a card with the full-colour logos. Scaled by country size;
 * where they'd overlap the bigger country wins (smaller ones appear on zoom).
 * Data: public/data/country-airlines.json (scripts/encyclopedia/build-countries.mjs).
 */

const SOURCE = 'country-airlines'
export const COUNTRY_AIRLINES_LAYER = 'country-airlines'
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

type Country = { iso: string; name: string; lon: number; lat: number; areaKm2: number; airlines: [string, string][] }
/** per airline: full logo, as served by our server */
type LogoIndex = Record<string, { logo?: string; icon?: string }>

let loading: Promise<void> | null = null
let logos: LogoIndex = {}
/** full logos (expanded card) */
const images = new Map<string, HTMLImageElement>()
/** the wordmark cut out of each logo, as an alpha mask (null: the logo has no text part) */
const wordmarks = new Map<string, HTMLCanvasElement | null>()
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

/** A wordmark in one colour. */
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
  const w = PAD * 2 + W1
  const h = PAD * 2 + H1 + (n - 1) * (H2 + GAP)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * PX)
  canvas.height = Math.ceil(h * PX)
  const ctx = canvas.getContext('2d')!
  ctx.scale(PX, PX)
  ctx.imageSmoothingQuality = 'high'
  c.airlines.forEach(([code, name], i) => {
    const W = i ? W2 : W1
    const H = i ? H2 : H1
    const x = PAD + (W1 - W) / 2
    const y = PAD + (i ? H1 + GAP + (i - 1) * (H2 + GAP) : 0)
    const color = i ? INK_2 : INK_1
    ctx.save()
    ctx.shadowColor = GLOW
    ctx.shadowBlur = 5
    const mark = wordmarks.get(code)
    if (mark) {
      const s = Math.min(W / mark.width, H / mark.height)
      const mw = mark.width * s
      const mh = mark.height * s
      const t = tint(code, mark, color)
      // twice: a stronger glow keeps light text readable over light map areas
      for (let k = 0; k < 2; k++) ctx.drawImage(t, x + (W - mw) / 2, y + (H - mh) / 2, mw, mh)
    } else {
      // no logo (or no text in it): the airline's name in the same style
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let size = i ? 10.5 : 13
      ctx.font = `600 ${size}px ${font}`
      while (size > 7.5 && ctx.measureText(name).width > W + 14) ctx.font = `600 ${(size -= 0.5)}px ${font}`
      for (let k = 0; k < 2; k++) ctx.fillText(name, x + W / 2, y + H / 2 + 0.5)
    }
    ctx.restore()
  })
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
      const src = logos[code]?.logo
      if (!src || images.has(code)) return
      const img = await loadImage(src)
      if (!img) return
      images.set(code, img)
      wordmarks.set(code, wordmarkOf(img))
      added++
    }),
  )
  return added
}

/**
 * The text part of a logo (its wordmark), without the symbol. Many airline logos
 * are a symbol plus a wordmark, side by side (Delta's triangle, Lufthansa's
 * crane, Turkish's disc) or stacked (Emirates' calligraphy over "Emirates").
 * "Ink" is what isn't transparent or the background colour; clear gaps split
 * the logo into pieces; a roughly square piece at one end is the symbol and is
 * dropped. Everything else is kept together (so spaced-out letters stay one
 * word). Returned as an alpha mask (the background removed), to be recoloured.
 * null when what's left isn't text-shaped (a logo that is only a symbol).
 */
function wordmarkOf(img: HTMLImageElement): HTMLCanvasElement | null {
  // Work on a rendered copy (~800 px wide). Crops come from this copy, not the
  // image: Chrome ignores the source area when drawing part of an SVG.
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
  const inkAt = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return px[i + 3] > 60 && (!bg || Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 60)
  }
  const inkBox = (x0: number, x1: number, y0: number, y1: number) => {
    let t = y1, b = y0 - 1, l = x1, r = x0 - 1
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (inkAt(x, y)) {
          if (y < t) t = y
          if (y > b) b = y
          if (x < l) l = x
          if (x > r) r = x
        }
    return { x0: l, x1: r + 1, y0: t, y1: b + 1 }
  }
  /** runs of ink along one axis, split by gaps of at least `minGap` */
  const runs = (len: number, has: (k: number) => boolean, minGap: number) => {
    const out: [number, number][] = []
    let start = -1
    let empty = 0
    for (let k = 0; k <= len; k++) {
      if (k < len && has(k)) {
        if (start < 0) start = k
        empty = 0
      } else if (start >= 0) {
        empty++
        if (empty >= minGap || k === len) {
          out.push([start, k - empty + 1])
          start = -1
          empty = 0
        }
      }
    }
    return out
  }
  const squarish = (bw: number, bh: number) => bh > 0 && bw / bh > 0.55 && bw / bh < 1.8

  let box = inkBox(0, w, 0, h)
  if (box.x1 <= box.x0) return null
  // side by side: drop a square piece at either end
  const cols = runs(w, (x) => { for (let y = box.y0; y < box.y1; y++) if (inkAt(x, y)) return true; return false }, Math.max(3, Math.round(w * 0.04)))
  if (cols.length >= 2) {
    const total = cols[cols.length - 1][1] - cols[0][0]
    const ends = [0, cols.length - 1]
    for (const e of ends) {
      const [a, b] = cols[e]
      const pb = inkBox(a, b, box.y0, box.y1)
      const rest = cols.filter((_, k) => k !== e)
      const rb = inkBox(rest[0][0], rest[rest.length - 1][1], box.y0, box.y1)
      // A symbol is roughly square and taller than the text beside it (so the
      // first or last letter of a widely spaced wordmark is never taken for one).
      if ((b - a) / total <= 0.45 && squarish(b - a, pb.y1 - pb.y0) && pb.y1 - pb.y0 >= (rb.y1 - rb.y0) * 1.05) {
        box = rb
        break
      }
    }
  }
  // stacked: drop a square piece at the top or bottom
  const rows = runs(box.y1 - box.y0, (k) => { for (let x = box.x0; x < box.x1; x++) if (inkAt(x, box.y0 + k)) return true; return false }, Math.max(3, Math.round(h * 0.06)))
  if (rows.length >= 2) {
    for (const e of [0, rows.length - 1]) {
      const [a, b] = rows[e]
      const pb = inkBox(box.x0, box.x1, box.y0 + a, box.y0 + b)
      if (squarish(pb.x1 - pb.x0, b - a) && pb.x1 - pb.x0 < (box.x1 - box.x0) * 0.6) {
        const rest = rows.filter((_, k) => k !== e)
        box = inkBox(box.x0, box.x1, box.y0 + rest[0][0], box.y0 + rest[rest.length - 1][1])
        break
      }
    }
  }
  const bw = box.x1 - box.x0
  const bh = box.y1 - box.y0
  if (bw <= 0 || bh <= 0 || bw / bh < 1.6) return null // not text-shaped: a symbol-only logo
  // the wordmark as a mask: ink kept (with its own transparency), background cleared
  const out = document.createElement('canvas')
  out.width = bw
  out.height = bh
  const o = out.getContext('2d')!
  const m = o.createImageData(bw, bh)
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const sx = box.x0 + x
      const sy = box.y0 + y
      const i = (sy * w + sx) * 4
      const j = (y * bw + x) * 4
      m.data[j] = m.data[j + 1] = m.data[j + 2] = 255
      m.data[j + 3] = inkAt(sx, sy) ? (bg ? 255 : px[i + 3]) : 0
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
