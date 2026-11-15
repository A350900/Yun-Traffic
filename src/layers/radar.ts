import { addProtocol, type Map as MLMap, type RasterTileSource } from 'maplibre-gl'
import type { RadarStyle } from './radarStyle'

/**
 * Weather radar from RainViewer (free tier: past ~2 h, 10-minute frames,
 * zoom ≤ 7, "Universal Blue" colours only, attribution required).
 *
 * Two raster layers are used as a double buffer: the next frame loads into
 * the hidden one, and only when its tiles are ready do the two swap. That
 * gives flicker-free playback and refreshes.
 *
 * In the "cartoon" style tiles go through the yunradar:// protocol, which
 * hands them to a Web Worker that repaints them (see radarWorker.ts).
 */

const API = 'https://api.rainviewer.com/public/weather-maps.json'
const REFRESH_MS = 5 * 60_000
const FRAME_MS = 650
const LOOP_PAUSE_MS = 1500
const ATTRIBUTION = 'Weather radar © <a href="https://www.rainviewer.com" target="_blank">RainViewer</a>'
const BUFFERS = ['radar-a', 'radar-b'] as const

export interface RadarFrame {
  time: number // epoch seconds
  path: string
}

export interface RadarState {
  visible: boolean
  style: RadarStyle
  opacity: number
  frames: RadarFrame[]
  /** Frame currently shown */
  index: number
  playing: boolean
  loading: boolean
  error: string | null
}

// ---------------------------------------------------------------- tile painter

let protocolReady = false
function registerProtocol() {
  if (protocolReady) return
  protocolReady = true
  const workers = Array.from(
    { length: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2)) },
    () => new Worker(new URL('./radarWorker.ts', import.meta.url), { type: 'module' }),
  )
  const pending = new Map<number, { resolve: (b: ImageBitmap) => void; reject: (e: Error) => void }>()
  let nextId = 0
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) {
        e.data.bitmap?.close() // request was cancelled
        return
      }
      pending.delete(e.data.id)
      if (e.data.bitmap) p.resolve(e.data.bitmap)
      else p.reject(new Error(e.data.error ?? 'radar tile failed'))
    }
  }
  addProtocol('yunradar', (params, abort) => {
    const id = nextId++
    const url = params.url.replace(/^yunradar:\/\//, 'https://')
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: (bitmap) => resolve({ data: bitmap }), reject })
      abort.signal.addEventListener('abort', () => {
        pending.delete(id)
        reject(new DOMException('aborted', 'AbortError'))
      })
      workers[id % workers.length].postMessage({ id, url })
    })
  })
}

// ---------------------------------------------------------------- controller

export class RadarController {
  private state: RadarState
  private listeners = new Set<() => void>()
  private map: MLMap | null = null
  private host = 'https://tilecache.rainviewer.com'
  private front = 0 // which buffer is showing
  private loadToken = 0
  private playTimer = 0
  private refreshTimer = 0
  private beforeId: string | undefined

  constructor(initial: Pick<RadarState, 'visible' | 'style' | 'opacity'>) {
    this.state = { ...initial, frames: [], index: -1, playing: false, loading: false, error: null }
  }

  // --- for React (useSyncExternalStore)
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getState = () => this.state
  private set(patch: Partial<RadarState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  /** Called once the map style has loaded. */
  attach(map: MLMap) {
    this.map = map
    registerProtocol()
    this.beforeId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    for (const id of BUFFERS) {
      map.addSource(id, { type: 'raster', tiles: [], tileSize: 512, maxzoom: 7, attribution: ATTRIBUTION })
      map.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
        },
        this.beforeId,
      )
    }
    if (this.state.visible) void this.start()
  }

  detach() {
    this.pause()
    clearInterval(this.refreshTimer)
    this.map = null
  }

  setVisible(visible: boolean) {
    if (visible === this.state.visible) return
    this.set({ visible })
    if (visible) void this.start()
    else {
      this.pause()
      clearInterval(this.refreshTimer)
      for (const id of BUFFERS) this.map?.getLayer(id) && this.map.setLayoutProperty(id, 'visibility', 'none')
    }
  }

  setStyle(style: RadarStyle) {
    if (style === this.state.style) return
    this.set({ style })
    if (this.state.visible && this.state.index >= 0) void this.show(this.state.index, true)
  }

  setOpacity(opacity: number) {
    this.set({ opacity })
    const id = BUFFERS[this.front]
    if (this.map?.getLayer(id)) this.map.setPaintProperty(id, 'raster-opacity', opacity)
  }

  play() {
    if (this.state.playing || this.state.frames.length < 2) return
    this.set({ playing: true })
    const step = async () => {
      if (!this.state.playing) return
      const last = this.state.frames.length - 1
      const next = this.state.index >= last ? 0 : this.state.index + 1
      await this.show(next)
      if (!this.state.playing) return
      this.playTimer = window.setTimeout(step, next === last ? LOOP_PAUSE_MS : FRAME_MS)
    }
    const startIdx = this.state.index >= this.state.frames.length - 1 ? -1 : this.state.index
    this.set({ index: startIdx < 0 ? this.state.frames.length - 1 : startIdx })
    void step()
  }

  pause() {
    clearTimeout(this.playTimer)
    if (this.state.playing) this.set({ playing: false })
  }

  /** Jump to a frame (from the time slider). */
  seek(index: number) {
    this.pause()
    void this.show(index)
  }

  private async start() {
    await this.fetchFrames()
    clearInterval(this.refreshTimer)
    this.refreshTimer = window.setInterval(() => void this.fetchFrames(), REFRESH_MS)
  }

  private async fetchFrames() {
    try {
      const res = await fetch(API)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { host: string; radar: { past: RadarFrame[] } }
      this.host = body.host
      const frames = body.radar.past
      const wasLatest = this.state.index < 0 || this.state.index >= this.state.frames.length - 1
      const prevTime = this.state.frames[this.state.index]?.time
      this.set({ frames, error: null })
      if (!this.state.playing) {
        // Stay on "now" unless the user scrubbed back in time.
        const idx = wasLatest ? frames.length - 1 : Math.max(0, frames.findIndex((f) => f.time === prevTime))
        if (this.state.visible) await this.show(idx, frames[idx]?.time !== prevTime)
      }
    } catch (err) {
      this.set({ error: `Radar unavailable (${(err as Error).message})` })
    }
  }

  private tileUrl(frame: RadarFrame) {
    // Cartoon: exact palette colours (no smoothing) so the worker can classify them.
    return this.state.style === 'cartoon'
      ? `${this.host.replace('https://', 'yunradar://')}${frame.path}/512/{z}/{x}/{y}/2/0_0.png`
      : `${this.host}${frame.path}/512/{z}/{x}/{y}/2/1_1.png`
  }

  /** Load a frame into the hidden buffer, then swap it in once its tiles are ready. */
  private async show(index: number, force = false) {
    const map = this.map
    const frame = this.state.frames[index]
    if (!map || !frame) return
    if (!force && index === this.state.index && map.getLayoutProperty(BUFFERS[this.front], 'visibility') === 'visible') return

    const token = ++this.loadToken
    const backIdx = 1 - this.front
    const back = BUFFERS[backIdx]
    ;(map.getSource(back) as RasterTileSource).setTiles([this.tileUrl(frame)])
    map.setLayoutProperty(back, 'visibility', 'visible')
    map.setPaintProperty(back, 'raster-opacity', 0)
    this.set({ loading: true })

    await this.whenLoaded(back)
    if (token !== this.loadToken || !this.map) return // superseded by a newer request

    map.setPaintProperty(back, 'raster-opacity', this.state.opacity)
    map.setPaintProperty(BUFFERS[this.front], 'raster-opacity', 0)
    map.setLayoutProperty(BUFFERS[this.front], 'visibility', 'none')
    this.front = backIdx
    this.set({ index, loading: false })
  }

  private whenLoaded(sourceId: string): Promise<void> {
    const map = this.map!
    return new Promise((resolve) => {
      const started = performance.now()
      const check = () => {
        if (!this.map) return resolve()
        // Give up waiting after 6s so a slow tile can't stall playback.
        if (map.isSourceLoaded(sourceId) || performance.now() - started > 6000) {
          map.off('sourcedata', onData)
          resolve()
        }
      }
      const onData = (e: { sourceId?: string }) => e.sourceId === sourceId && check()
      map.on('sourcedata', onData)
      setTimeout(check, 50)
      setTimeout(check, 6100)
    })
  }
}
