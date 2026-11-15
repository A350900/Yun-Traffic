/// <reference lib="webworker" />
// Paints "cartoon" radar tiles off the main thread.
//
// 1. Classify each pixel of the RainViewer tile into a band (light…intense).
// 2. For each band, blur its mask and re-threshold it: ragged radar speckle
//    becomes soft rounded blobs.
// 3. Fill the blobs with flat colours from our palette, plus a soft outline.

import { bandForColor, CARTOON_BANDS, CARTOON_OUTLINE } from './radarStyle'

interface Job {
  id: number
  url: string
}

const cache = new Map<number, number>() // packed RGBA -> band

/** In-place separable box blur (two passes ≈ gaussian). */
function blur(src: Float32Array, w: number, h: number, r: number, tmp: Float32Array) {
  const norm = 1 / (2 * r + 1)
  for (let pass = 0; pass < 2; pass++) {
    // horizontal: src -> tmp
    for (let y = 0; y < h; y++) {
      const row = y * w
      let sum = 0
      for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))]
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum * norm
        sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
      }
    }
    // vertical: tmp -> src
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x]
      for (let y = 0; y < h; y++) {
        src[y * w + x] = sum * norm
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
      }
    }
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function paint(img: ImageData): ImageData {
  const { width: w, height: h, data } = img
  const n = w * h
  const level = new Uint8Array(n)
  let maxLevel = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const a = data[o + 3]
    if (!a) continue
    const key = ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | a) >>> 0
    let lv = cache.get(key)
    if (lv === undefined) {
      lv = bandForColor(data[o], data[o + 1], data[o + 2], a)
      cache.set(key, lv)
    }
    level[i] = lv
    if (lv > maxLevel) maxLevel = lv
  }

  const out = new ImageData(w, h)
  if (!maxLevel) return out
  const px = out.data
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  const al = new Float32Array(n)
  const mask = new Float32Array(n)
  const tmp = new Float32Array(n)
  const radius = Math.max(2, Math.round(w / 110)) // ~5px on a 512px tile

  for (let k = 1; k <= maxLevel; k++) {
    for (let i = 0; i < n; i++) mask[i] = level[i] >= k ? 1 : 0
    blur(mask, w, h, k === 1 ? radius + 1 : radius, tmp)
    const band = CARTOON_BANDS[k - 1]
    const [cr, cg, cb] = band.rgb
    for (let i = 0; i < n; i++) {
      const m = mask[i]
      if (m < 0.4) continue
      // Anti-aliased edge, then "over" compositing onto what's below.
      const cov = smoothstep(0.42, 0.56, m) * band.alpha
      if (k === 1) {
        // Soft outline hugging the outside edge of all rain.
        const edge = smoothstep(0.42, 0.5, m) * (1 - smoothstep(0.5, 0.64, m)) * CARTOON_OUTLINE.alpha
        const [or, og, ob] = CARTOON_OUTLINE.rgb
        const a2 = Math.max(cov, edge)
        const t = a2 > 0 ? edge / (cov + edge) : 0
        r[i] = cr + (or - cr) * t
        g[i] = cg + (og - cg) * t
        b[i] = cb + (ob - cb) * t
        al[i] = a2
      } else {
        const outA = cov + al[i] * (1 - cov)
        if (outA > 0) {
          r[i] = (cr * cov + r[i] * al[i] * (1 - cov)) / outA
          g[i] = (cg * cov + g[i] * al[i] * (1 - cov)) / outA
          b[i] = (cb * cov + b[i] * al[i] * (1 - cov)) / outA
        }
        al[i] = outA
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (!al[i]) continue
    const o = i * 4
    px[o] = r[i]
    px[o + 1] = g[i]
    px[o + 2] = b[i]
    px[o + 3] = al[i] * 255
  }
  return out
}

/** Tile URL → its z/x/y, so neighbours can be fetched. */
const TILE_RE = /\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+_\d+)\.png$/

async function loadBitmap(url: string): Promise<ImageBitmap | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  return createImageBitmap(await res.blob())
}

/**
 * Smoothing near a tile's edge needs the pixels just across it, or blobs get
 * cut off with a visible seam. So we paint each tile on a slightly larger
 * canvas that includes a margin from its neighbours, fetching a neighbour
 * only when there's rain along that shared edge (they're usually cached).
 */
async function processTile(url: string): Promise<ImageBitmap> {
  const center = await loadBitmap(url)
  if (!center) throw new Error('tile fetch failed')
  const size = center.width
  const pad = Math.round(size / 24) // ~21px at 512: more than the blur reaches
  const full = size + 2 * pad
  const canvas = new OffscreenCanvas(full, full)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(center, pad, pad)
  center.close()

  const m = url.match(TILE_RE)
  if (m) {
    const [, tileSize, zs, xs, ys, color, opts] = m
    const z = +zs, x = +xs, y = +ys, n = 2 ** z
    const prefix = url.slice(0, url.length - m[0].length)
    // Which edges have rain? Check thin strips just inside each edge.
    const hasRain = (sx: number, sy: number, w: number, h: number) => {
      const d = ctx.getImageData(sx, sy, w, h).data
      for (let i = 3; i < d.length; i += 4) if (d[i] >= 80) return true
      return false
    }
    const left = hasRain(pad, pad, pad, size)
    const right = hasRain(pad + size - pad, pad, pad, size)
    const top = hasRain(pad, pad, size, pad)
    const bottom = hasRain(pad, pad + size - pad, size, pad)
    const jobs: Promise<void>[] = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const need = (dx < 0 ? left : dx > 0 ? right : true) && (dy < 0 ? top : dy > 0 ? bottom : true)
        const ny = y + dy
        if (!need || ny < 0 || ny >= n) continue
        const nx = (x + dx + n) % n
        jobs.push(
          loadBitmap(`${prefix}/${tileSize}/${z}/${nx}/${ny}/${color}/${opts}.png`)
            .then((bmp) => {
              if (!bmp) return
              ctx.drawImage(bmp, pad + dx * size, pad + dy * size)
              bmp.close()
            })
            .catch(() => {}),
        )
      }
    }
    await Promise.all(jobs)
  }

  const painted = paint(ctx.getImageData(0, 0, full, full))
  const out = new OffscreenCanvas(size, size)
  out.getContext('2d')!.putImageData(painted, -pad, -pad)
  return out.transferToImageBitmap()
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, url } = e.data
  try {
    const bitmap = await processTile(url)
    ;(self as unknown as Worker).postMessage({ id, bitmap }, [bitmap])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: (err as Error).message })
  }
}
