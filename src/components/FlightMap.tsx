import { memo, useEffect, useRef } from 'react'
import { Map as MLMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre v6 looks for its worker next to its own script, which a bundler
// moves. Have Vite emit the worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { THEMES, ACTIVE_THEME } from '../config/theme'
import { LocateIcon, MinusIcon, PlusIcon } from './Icons'
import { startFeed, startStressFeed, type FeedState, type FocusHint } from '../flights/feed'
import { addAircraftLayers, LAYER, setSelected, updateAircraftSource, type ViewWindow } from '../flights/layer'
import { addDayNightLayer, setDayNightVisible, updateDayNight } from '../layers/dayNight'
import type { RadarController } from '../layers/radar'
import type { SelectionStore } from '../flights/selection'
import { addPathLayers, clearPath, updatePath } from '../flights/pathLayer'
import { extrapolate } from '../flights/position'
import { F } from '../../shared/wire'

const theme = THEMES[ACTIVE_THEME]
setWorkerUrl(workerUrl)

/** How often to check whether aircraft need re-drawing. */
const TICK_MS = 250
/** Fastest redraw (zoomed in) and slowest (whole world). */
const MIN_REDRAW_MS = 1000
const MAX_REDRAW_MS = 6000
/** Below this zoom every aircraft is sent; above it only those near the screen. */
const CULL_MIN_ZOOM = 4
/** Above this many aircraft an update is costly enough to hold off mid-gesture. */
const HOLD_DURING_GESTURE_ABOVE = 3000

/**
 * How long until a fast airliner (~500 kt) moves half a pixel at this zoom.
 * No point redrawing more often than that: at the world view it's ~40 s.
 */
function redrawInterval(map: MLMap) {
  const metersPerPixel = (40_075_016 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
  const ms = ((0.5 * metersPerPixel) / 257) * 1000
  return Math.min(MAX_REDRAW_MS, Math.max(MIN_REDRAW_MS, ms))
}

/** The visible area plus one screen-width of margin on every side. */
function viewWindow(map: MLMap): ViewWindow | null {
  if (map.getZoom() < CULL_MIN_ZOOM) return null
  const b = map.getBounds()
  const c = map.getCenter()
  const halfLon = Math.min(180, ((b.getEast() - b.getWest()) / 2) * 3)
  const latSpan = b.getNorth() - b.getSouth()
  return { centerLon: c.lng, halfLon, south: b.getSouth() - latSpan, north: b.getNorth() + latSpan }
}

/** Is the current view still inside the area we last sent aircraft for? */
function covers(win: ViewWindow, map: MLMap) {
  const b = map.getBounds()
  const half = (b.getEast() - b.getWest()) / 2
  const dLon = Math.abs(((map.getCenter().lng - win.centerLon + 540) % 360) - 180)
  return dLon + half <= win.halfLon && b.getSouth() >= win.south && b.getNorth() <= win.north
}
/** Only ask the server for regional detail once zoomed in this far. */
const FOCUS_MIN_ZOOM = 5

interface Props {
  selected: string | null
  onSelect: (hex: string | null) => void
  onFeed: (state: FeedState) => void
  /** Show the day/night (solar terminator) overlay */
  dayNight: boolean
  radar: RadarController
  selection: SelectionStore
}

/** Rough radius of the visible area in nautical miles. */
function focusFor(map: MLMap): FocusHint | null {
  if (map.getZoom() < FOCUS_MIN_ZOOM) return null
  const c = map.getCenter()
  const b = map.getBounds()
  const radiusNm = Math.min(250, c.distanceTo(b.getNorthEast()) / 1852)
  return { lat: c.lat, lon: c.lng, radiusNm: Math.max(radiusNm, 25) }
}

function FlightMap({ selected, onSelect, onFeed, dayNight, radar, selection }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const onSelectRef = useRef(onSelect)
  const onFeedRef = useRef(onFeed)
  const dayNightRef = useRef(dayNight)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  onSelectRef.current = onSelect
  onFeedRef.current = onFeed
  dayNightRef.current = dayNight

  useEffect(() => {
    if (!containerRef.current) return

    const map = new MLMap({
      container: containerRef.current,
      style: theme.mapStyle,
      center: [-30, 35],
      zoom: 2.2,
      // Keep the view in the URL (#zoom/lat/lon) so it can be shared/bookmarked.
      hash: true,
      minZoom: 1.5,
      // Flat 2D map: no tilting or rotating.
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: {
        compact: true,
        customAttribution:
          'Aircraft data © <a href="https://adsb.lol" target="_blank">adsb.lol</a> (ODbL), <a href="https://opensky-network.org" target="_blank">The OpenSky Network</a>, <a href="https://adsb.fi" target="_blank">adsb.fi</a>',
      },
    })
    mapRef.current = map

    // --- Live aircraft --------------------------------------------------
    const stressCount = Number(new URLSearchParams(location.search).get('stress')) || 0
    const feed = stressCount
      ? startStressFeed(stressCount, (s) => onFeedRef.current(s))
      : startFeed(() => focusFor(map), (s) => onFeedRef.current(s))

    let renderTimer = 0
    let dayNightTimer = 0
    let lastDraw = 0
    let lastWindow: ViewWindow | null = null
    let lastZoomBand = -1
    let needsDraw = true
    let lastSent = 0

    const draw = () => {
      const s = feed.state
      lastWindow = viewWindow(map)
      lastZoomBand = Math.floor(map.getZoom())
      const { ms, sent } = updateAircraftSource(map, s.aircraft, Date.now() + s.clockOffset, lastWindow, selectedRef.current)
      lastSent = sent
      lastDraw = performance.now()
      needsDraw = false
      drawPath()
      // Exposed for debugging / perf checks in the console.
      ;(window as unknown as Record<string, unknown>).__yun = { count: s.aircraft.size, sent, buildMs: ms, map }
    }

    // The selected flight's path, ending at the aircraft's current position.
    const drawPath = () => {
      if (!map.getSource('path-flown')) return
      const sel = selection.getState()
      if (!sel.hex) return clearPath(map)
      const ac = feed.state.aircraft.get(sel.hex)
      const live = ac
        ? (() => {
            const [lon, lat] = extrapolate(ac, Date.now() + feed.state.clockOffset)
            return { lon, lat, alt: ac[F.Alt] ?? 0 }
          })()
        : null
      updatePath(map, sel.trace?.hex === sel.hex ? sel.trace : null, sel.info?.hex === sel.hex ? sel.info : null, live)
    }
    const unsubscribeSelection = selection.subscribe(drawPath)

    // Redraw only when it would visibly change something.
    const tick = () => {
      if (document.hidden || !map.getSource('aircraft')) return
      const since = performance.now() - lastDraw
      if (map.isMoving()) {
        // Panned past the area we sent aircraft for: fill it in right away.
        if (lastWindow && !covers(lastWindow, map)) return draw()
        // Big updates (thousands of aircraft, zoomed out) wait until the gesture
        // ends so dragging stays smooth; at those zooms aircraft move less than
        // a pixel in 10 s, so nothing visible is lost.
        // Zoomed in, updates are small, so aircraft keep moving while you drag.
        if (lastSent > HOLD_DURING_GESTURE_ABOVE && since < 10_000) return
      }
      if (needsDraw || since >= redrawInterval(map)) draw()
    }

    // After the view changes, redraw at once if we panned beyond the area we
    // sent aircraft for, or zoomed into a level where culling changes.
    map.on('moveend', () => {
      const zoomBand = Math.floor(map.getZoom())
      const win = viewWindow(map)
      if ((win === null) !== (lastWindow === null) || (lastWindow && !covers(lastWindow, map)) || zoomBand !== lastZoomBand) {
        needsDraw = true
        tick()
      }
    })
    const onVisible = () => {
      if (!document.hidden) {
        needsDraw = true
        tick()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    // --------------------------------------------------------------------

    map.on('style.load', () => {
      // Day/night first so it sits underneath the aircraft.
      addDayNightLayer(map, dayNightRef.current)
      dayNightTimer = window.setInterval(() => updateDayNight(map), 60_000)
      radar.attach(map) // above day/night, below labels and aircraft
      addAircraftLayers(map)
      addPathLayers(map, LAYER) // under the aircraft icons
      draw()
      renderTimer = window.setInterval(tick, TICK_MS)
    })

    map.on('click', LAYER, (e) => {
      const hex = e.features?.[0]?.properties?.hex as string | undefined
      if (hex) onSelectRef.current(hex)
    })
    map.on('click', (e) => {
      // Clicking empty map clears the selection.
      if (!map.queryRenderedFeatures(e.point, { layers: [LAYER] }).length) onSelectRef.current(null)
    })
    map.on('mouseenter', LAYER, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', LAYER, () => (map.getCanvas().style.cursor = ''))
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()

    return () => {
      clearInterval(renderTimer)
      clearInterval(dayNightTimer)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribeSelection()
      radar.detach()
      feed.stop()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map) setSelected(map, selected)
  }, [selected])

  useEffect(() => {
    const map = mapRef.current
    if (map) setDayNightVisible(map, dayNight)
  }, [dayNight])

  const locate = () => {
    const map = mapRef.current
    if (!map || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => map.flyTo({ center: [coords.longitude, coords.latitude], zoom: 7 }),
      () => {},
    )
  }

  return (
    <>
      <div ref={containerRef} className="map" style={{ background: theme.background }} />

      <div className="map-controls">
        <div className="control-group">
          <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}><PlusIcon /></button>
          <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}><MinusIcon /></button>
        </div>
        <button className="control-single" aria-label="My location" title="My location" onClick={locate}>
          <LocateIcon />
        </button>
      </div>
    </>
  )
}

// Only re-render when props change (App re-renders every second for its clock).
export default memo(FlightMap)
