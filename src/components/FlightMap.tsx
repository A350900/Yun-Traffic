import { memo, useEffect, useRef } from 'react'
import { Map as MLMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre v6 looks for its worker next to its own script, which a bundler
// moves. Have Vite emit the worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { THEMES, ACTIVE_THEME } from '../config/theme'
import { LocateIcon, MinusIcon, PlusIcon } from './Icons'
import { startFeed, startStressFeed, type FeedState, type FocusHint } from '../flights/feed'
import { addAircraftLayers, BANDS, ICON_LAYERS, updateAircraftBand, updateSelected, type ViewWindow } from '../flights/layer'
import { addDayNightLayer, setDayNightVisible, updateDayNight } from '../layers/dayNight'
import type { RadarController } from '../layers/radar'
import type { SelectionStore } from '../flights/selection'
import { addPathLayers, clearPath, updatePath } from '../flights/pathLayer'
import { addAirportLayer, AIRPORT_LAYER, setAirportsVisible } from '../layers/airports'
import { setFirVisible } from '../layers/fir'
import { COUNTRY_AIRLINES_LAYER, expandStack, setCountryAirlinesVisible } from '../layers/countryAirlines'
import { extrapolate } from '../flights/position'
import { F } from '../../shared/wire'
import type { SimController } from '../sim/client' // simulated traffic

const theme = THEMES[ACTIVE_THEME]
setWorkerUrl(workerUrl)

/** How often to check whether aircraft need re-drawing. */
const TICK_MS = 250
/** Fastest redraw (zoomed in) and slowest (whole world). */
const MIN_REDRAW_MS = 1000
const MAX_REDRAW_MS = 12_000
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
  onSelect: (hex: string | null) => void
  /** a busiest-airport pin was clicked (ICAO) */
  onSelectAirport: (icao: string) => void
  /** Show en-route control boundaries (FIRs) */
  firBoundaries: boolean
  /** Show the busiest-airport pins */
  airports: boolean
  /** Encyclopedia: each country's main airlines */
  countryAirlines: boolean
  /** Tracking mode: live/simulated traffic shown and updated. Off = Encyclopedia mode (no traffic). */
  tracking: boolean
  onFeed: (state: FeedState) => void
  /** Show the day/night (solar terminator) overlay */
  dayNight: boolean
  radar: RadarController
  selection: SelectionStore
  /** simulated traffic */
  sim: SimController
  simEnabled: boolean
  simShowAreas: boolean
}

/** Everything that shows traffic: live aircraft (icons, labels, selection), flight paths, simulated aircraft. */
const isTrafficLayer = (id: string) => id.startsWith('aircraft-') || id.startsWith('path-') || id === 'sim-icons'
function setTrafficVisible(map: MLMap, visible: boolean) {
  for (const l of map.getStyle().layers) if (isTrafficLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', visible ? 'visible' : 'none')
}

/** Rough radius of the visible area in nautical miles. */
function focusFor(map: MLMap): FocusHint | null {
  if (map.getZoom() < FOCUS_MIN_ZOOM) return null
  const c = map.getCenter()
  const b = map.getBounds()
  const radiusNm = Math.min(250, c.distanceTo(b.getNorthEast()) / 1852)
  return { lat: c.lat, lon: c.lng, radiusNm: Math.max(radiusNm, 25) }
}

function FlightMap({ onSelect, onSelectAirport, firBoundaries, airports, countryAirlines, tracking, onFeed, dayNight, radar, selection, sim, simEnabled, simShowAreas }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const onSelectRef = useRef(onSelect)
  const onSelectAirportRef = useRef(onSelectAirport)
  onSelectAirportRef.current = onSelectAirport
  const trackingRef = useRef(tracking)
  trackingRef.current = tracking
  /** live feed controls + "redraw everything" for the mode effect below */
  const trafficRef = useRef<{ setPaused: (p: boolean) => void; redrawAll: () => void } | null>(null)
  const countryAirlinesRef = useRef(countryAirlines)
  countryAirlinesRef.current = countryAirlines
  const airportsRef = useRef(airports)
  airportsRef.current = airports
  const firRef = useRef(firBoundaries)
  firRef.current = firBoundaries
  const onFeedRef = useRef(onFeed)
  const dayNightRef = useRef(dayNight)
  const simEnabledRef = useRef(simEnabled) // simulated traffic
  simEnabledRef.current = simEnabled
  onSelectRef.current = onSelect
  onFeedRef.current = onFeed
  dayNightRef.current = dayNight

  useEffect(() => {
    if (!containerRef.current) return

    const map = new MLMap({
      container: containerRef.current,
      style: theme.mapStyle,
      center: [-150, 40], // North Pacific: Asia on the left, the Americas on the right
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
          'Aircraft data © <a href="https://adsb.lol" target="_blank">adsb.lol</a> (ODbL), <a href="https://opensky-network.org" target="_blank">The OpenSky Network</a>, <a href="https://airplanes.live" target="_blank">airplanes.live</a>',
      },
    })
    mapRef.current = map

    // --- Live aircraft --------------------------------------------------
    let hadAircraft = false
    const stressCount = Number(new URLSearchParams(location.search).get('stress')) || 0
    const feed = stressCount
      ? startStressFeed(stressCount, (s) => onFeedRef.current(s))
      : startFeed(
          () => focusFor(map),
          (s) => {
            // First aircraft in: draw them all now rather than waiting for the
            // regular (slow, zoomed-out) refresh cycle to reach every group.
            if (!hadAircraft && s.aircraft.size > 0) {
              hadAircraft = true
              refreshAll = true
              if (map.getSource('aircraft-0')) tick()
            }
            onFeedRef.current(s)
          },
        )

    let renderTimer = 0
    let dayNightTimer = 0
    // Per group (see BANDS in layer.ts): when it was last sent, for which area, how many.
    // -Infinity = never drawn (performance.now() starts near 0, so 0 would read as "just drawn")
    const lastDraw = new Array<number>(BANDS).fill(-Infinity)
    const windows = new Array<ViewWindow | null>(BANDS).fill(null)
    const sentPerBand = new Array<number>(BANDS).fill(0)
    let lastZoomBand = -1
    let refreshAll = true
    let lastPathDraw = 0
    // Zoomed out (thousands of aircraft) the work is split over BANDS groups;
    // zoomed in, updates are small and one group is cheaper.
    let groups = BANDS
    let lastAnyDraw = -Infinity
    const now = () => Date.now() + feed.state.clockOffset
    const totalSent = () => sentPerBand.reduce((a, b) => a + b, 0)

    const drawBand = (b: number) => {
      const win = viewWindow(map)
      windows[b] = win
      lastZoomBand = Math.floor(map.getZoom())
      sentPerBand[b] = updateAircraftBand(map, b, feed.state.aircraft, now(), win, groups)
      lastDraw[b] = lastAnyDraw = performance.now()
      ;(window as unknown as Record<string, unknown>).__yun = { count: feed.state.aircraft.size, sent: totalSent(), map }
    }

    // Refresh every group, one per animation frame so no single frame does it all.
    let refreshing = false
    const drawAllProgressively = () => {
      if (refreshing) return
      refreshing = true
      refreshAll = false
      groups = viewWindow(map) ? 1 : BANDS
      let b = 0
      const step = () => {
        drawBand(b++)
        if (b < BANDS) requestAnimationFrame(step)
        else refreshing = false
      }
      requestAnimationFrame(step)
    }

    // The selected flight: highlight + path, ending at its current position.
    const drawSelection = () => {
      const sel = selection.getState()
      const ac = sel.hex ? feed.state.aircraft.get(sel.hex) : undefined
      updateSelected(map, ac, now())
      if (!map.getSource('path-flown')) return
      lastPathDraw = performance.now()
      if (!sel.hex) return clearPath(map)
      const live = ac
        ? (() => {
            const [lon, lat] = extrapolate(ac, now())
            return { lon, lat, alt: ac[F.Alt] ?? 0 }
          })()
        : null
      updatePath(map, sel.trace?.hex === sel.hex ? sel.trace : null, sel.info?.hex === sel.hex ? sel.info : null, live)
    }
    const unsubscribeSelection = selection.subscribe(drawSelection)

    const coveredByAll = () => windows.every((w) => !w || covers(w, map))

    // Every 250 ms: update at most one group, and only when it would visibly
    // change something. Groups come due a fraction of the interval apart.
    let simForce = false // simulated traffic: refresh after the view changes
    const tick = () => {
      if (document.hidden || !map.getSource('aircraft-0') || !trackingRef.current) return
      if (selection.getState().hex && performance.now() - lastPathDraw >= 1000) drawSelection()
      // simulated traffic: computed in a worker; held during gestures when zoomed out (like live)
      if (sim.enabled && !(map.isMoving() && !viewWindow(map))) {
        sim.tick({ now: now(), view: viewWindow(map), interval: redrawInterval(map), force: simForce, aircraft: feed.state.aircraft.values(), liveCount: feed.state.aircraft.size })
        simForce = false
      }
      if (refreshAll) return drawAllProgressively()
      if (map.isMoving()) {
        // Panned past the area we sent aircraft for: fill it in right away.
        if (!coveredByAll()) return drawAllProgressively()
        // Big updates (thousands of aircraft, zoomed out) wait until the gesture
        // ends so dragging stays smooth; at those zooms aircraft move less than
        // a pixel in 10 s, so nothing visible is lost.
        if (totalSent() > HOLD_DURING_GESTURE_ABOVE && performance.now() - Math.min(...lastDraw.slice(0, groups)) < 10_000) return
      }
      const interval = redrawInterval(map)
      const t = performance.now()
      // Keep group updates evenly spaced through the interval, never bunched.
      if (t - lastAnyDraw < interval / groups) return
      let oldest = 0
      for (let b = 1; b < groups; b++) if (lastDraw[b] < lastDraw[oldest]) oldest = b
      if (t - lastDraw[oldest] >= interval) drawBand(oldest)
    }

    // After the view changes, redraw at once if we panned beyond the area we
    // sent aircraft for, or zoomed into a level where culling changes.
    map.on('moveend', () => {
      simForce = true // simulated traffic
      const zoomBand = Math.floor(map.getZoom())
      const culling = viewWindow(map) !== null
      if (culling !== (windows[0] !== null) || !coveredByAll() || zoomBand !== lastZoomBand) drawAllProgressively()
    })
    const onVisible = () => {
      if (!document.hidden) drawAllProgressively()
    }
    document.addEventListener('visibilitychange', onVisible)
    // --------------------------------------------------------------------

    trafficRef.current = {
      setPaused: (p) => feed.setPaused(p),
      redrawAll: () => {
        refreshAll = true
        simForce = true
      },
    }
    if (!trackingRef.current) feed.setPaused(true)

    map.on('style.load', () => {
      // Day/night first so it sits underneath the aircraft.
      addDayNightLayer(map, dayNightRef.current)
      dayNightTimer = window.setInterval(() => updateDayNight(map), 60_000)
      radar.attach(map) // above day/night, below labels and aircraft
      addAircraftLayers(map)
      addPathLayers(map, ICON_LAYERS[0]) // under the aircraft icons
      if (simEnabledRef.current) sim.enable(map, ICON_LAYERS[0]) // simulated traffic, under live aircraft
      addAirportLayer(map) // busiest airports: on top
      setAirportsVisible(map, airportsRef.current)
      setTrafficVisible(map, trackingRef.current)
      if (countryAirlinesRef.current) setCountryAirlinesVisible(map, true)
      if (firRef.current) setFirVisible(map, true, ICON_LAYERS[0]) // control boundaries, under everything of ours
      drawAllProgressively()
      renderTimer = window.setInterval(tick, TICK_MS)
    })

    map.on('click', (e) => {
      // A few pixels of slack makes small icons easier to hit.
      const box: [[number, number], [number, number]] = [
        [e.point.x - 4, e.point.y - 4],
        [e.point.x + 4, e.point.y + 4],
      ]
      // Airport pins sit on top, so they're checked first.
      const pin = map.getLayer(AIRPORT_LAYER) ? map.queryRenderedFeatures(e.point, { layers: [AIRPORT_LAYER] })[0] : undefined
      if (pin) return onSelectAirportRef.current(pin.properties.icao as string)
      // Encyclopedia: a country's airline stack grows into a card.
      const stack = map.getLayer(COUNTRY_AIRLINES_LAYER) ? map.queryRenderedFeatures(e.point, { layers: [COUNTRY_AIRLINES_LAYER] })[0] : undefined
      if (stack) return expandStack(map, stack.properties.iso as string)
      const hit = map.queryRenderedFeatures(box, { layers: ICON_LAYERS })[0]
      // Clicking empty map clears the selection.
      onSelectRef.current((hit?.properties?.hex as string | undefined) ?? null)
    })
    for (const id of [...ICON_LAYERS, AIRPORT_LAYER, COUNTRY_AIRLINES_LAYER]) {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''))
    }
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()

    return () => {
      clearInterval(renderTimer)
      clearInterval(dayNightTimer)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribeSelection()
      radar.detach()
      sim.disable() // simulated traffic
      feed.stop()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map) setDayNightVisible(map, dayNight)
  }, [dayNight])

  useEffect(() => {
    const map = mapRef.current
    if (map) setAirportsVisible(map, airports)
  }, [airports])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getSource('aircraft-0')) setCountryAirlinesVisible(map, countryAirlines)
  }, [countryAirlines])

  // Tracking / Encyclopedia: show or hide all traffic, and pause the live feed
  // (nothing is fetched or drawn for traffic in Encyclopedia mode).
  useEffect(() => {
    const map = mapRef.current
    trafficRef.current?.setPaused(!tracking)
    if (map?.getSource('aircraft-0')) setTrafficVisible(map, tracking)
    if (tracking) trafficRef.current?.redrawAll()
  }, [tracking])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getSource('aircraft-0')) setFirVisible(map, firBoundaries, ICON_LAYERS[0])
  }, [firBoundaries])

  // simulated traffic: switched on/off in Settings
  useEffect(() => {
    const map = mapRef.current
    if (!map?.getSource('aircraft-0')) return // not loaded yet: style.load handles it
    if (simEnabled) sim.enable(map, ICON_LAYERS[0])
    else sim.disable()
  }, [simEnabled, sim])
  useEffect(() => sim.setShowAreas(simShowAreas), [simShowAreas, sim])

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
