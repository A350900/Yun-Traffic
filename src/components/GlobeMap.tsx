import { useEffect, useRef, useState } from 'react'
import { Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { THEMES, ACTIVE_THEME } from '../config/theme'
import { CompassIcon, FlatMapIcon, GlobeIcon, LocateIcon, MinusIcon, PlusIcon } from './Icons'

const theme = THEMES[ACTIVE_THEME]

/** Degrees of longitude per second while the globe idles. */
const SPIN_SPEED = 2

export default function GlobeMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [isGlobe, setIsGlobe] = useState(true)
  const [bearing, setBearing] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return

    const map = new MLMap({
      container: containerRef.current,
      style: theme.mapStyle,
      center: [-40, 30],
      zoom: 1.6,
      minZoom: 1,
      maxPitch: 70,
      attributionControl: { compact: true },
    })
    mapRef.current = map

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' })
      map.setSky({
        'sky-color': theme.spaceColor,
        'horizon-color': '#c8456b',
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 5, 0.25, 7, 0],
      })
    })

    map.on('rotate', () => setBearing(map.getBearing()))

    // Gentle idle spin until the user first touches the map.
    let spinning = true
    let last = performance.now()
    let frame = 0
    const stop = () => { spinning = false }
    map.on('mousedown', stop)
    map.on('touchstart', stop)
    map.on('wheel', stop)
    const spin = (now: number) => {
      if (!spinning) return
      const dt = (now - last) / 1000
      last = now
      if (map.isStyleLoaded() && !map.isMoving()) {
        const c = map.getCenter()
        map.setCenter([c.lng + SPIN_SPEED * dt, c.lat])
      }
      frame = requestAnimationFrame(spin)
    }
    frame = requestAnimationFrame(spin)

    return () => {
      cancelAnimationFrame(frame)
      map.remove()
      mapRef.current = null
    }
  }, [])

  const toggleProjection = () => {
    const map = mapRef.current
    if (!map) return
    const next = !isGlobe
    map.setProjection({ type: next ? 'globe' : 'mercator' })
    setIsGlobe(next)
  }

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
      <div ref={containerRef} className="map" style={{ background: theme.spaceColor }} />

      <div className="map-controls">
        <div className="control-group">
          <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}><PlusIcon /></button>
          <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}><MinusIcon /></button>
        </div>
        <button
          className="control-single"
          aria-label={isGlobe ? 'Switch to flat map' : 'Switch to globe'}
          title={isGlobe ? 'Flat map' : 'Globe'}
          onClick={toggleProjection}
        >
          {isGlobe ? <FlatMapIcon /> : <GlobeIcon />}
        </button>
        <button
          className="control-single"
          aria-label="Reset north"
          title="Reset north"
          onClick={() => mapRef.current?.resetNorthPitch()}
        >
          <CompassIcon style={{ transform: `rotate(${-bearing}deg)` }} />
        </button>
        <button className="control-single" aria-label="My location" title="My location" onClick={locate}>
          <LocateIcon />
        </button>
      </div>
    </>
  )
}
