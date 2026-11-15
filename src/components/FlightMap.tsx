import { useEffect, useRef } from 'react'
import { Map as MLMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre v6 looks for its worker next to its own script, which a bundler
// moves. Have Vite emit the worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { THEMES, ACTIVE_THEME } from '../config/theme'
import { LocateIcon, MinusIcon, PlusIcon } from './Icons'
import { startFeed, startStressFeed, type FeedState, type FocusHint } from '../flights/feed'
import { addAircraftLayers, LAYER, setSelected, updateAircraftSource } from '../flights/layer'
import { addDayNightLayer, setDayNightVisible, updateDayNight } from '../layers/dayNight'

const theme = THEMES[ACTIVE_THEME]
setWorkerUrl(workerUrl)

/** How often aircraft positions are re-projected and re-uploaded. */
const RENDER_MS = 1000
/** Only ask the server for regional detail once zoomed in this far. */
const FOCUS_MIN_ZOOM = 5

interface Props {
  selected: string | null
  onSelect: (hex: string | null) => void
  onFeed: (state: FeedState) => void
  /** Show the day/night (solar terminator) overlay */
  dayNight: boolean
}

/** Rough radius of the visible area in nautical miles. */
function focusFor(map: MLMap): FocusHint | null {
  if (map.getZoom() < FOCUS_MIN_ZOOM) return null
  const c = map.getCenter()
  const b = map.getBounds()
  const radiusNm = Math.min(250, c.distanceTo(b.getNorthEast()) / 1852)
  return { lat: c.lat, lon: c.lng, radiusNm: Math.max(radiusNm, 25) }
}

export default function FlightMap({ selected, onSelect, onFeed, dayNight }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const onSelectRef = useRef(onSelect)
  const onFeedRef = useRef(onFeed)
  const dayNightRef = useRef(dayNight)
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
    const render = () => {
      const s = feed.state
      const ms = updateAircraftSource(map, s.aircraft, Date.now() + s.clockOffset)
      // Exposed for debugging / perf checks in the console.
      ;(window as unknown as Record<string, unknown>).__yun = { count: s.aircraft.size, buildMs: ms, map }
    }
    // --------------------------------------------------------------------

    map.on('style.load', () => {
      // Day/night first so it sits underneath the aircraft.
      addDayNightLayer(map, dayNightRef.current)
      dayNightTimer = window.setInterval(() => updateDayNight(map), 60_000)
      addAircraftLayers(map)
      render()
      renderTimer = window.setInterval(render, RENDER_MS)
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
