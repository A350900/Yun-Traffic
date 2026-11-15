import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { FilterIcon, LayersIcon, PlaybackIcon, SettingsIcon, StatsIcon, WeatherIcon } from './Icons'
import LayersMenu from './LayersMenu'
import WeatherPanel from './WeatherPanel'
import type { RadarController } from '../layers/radar'
import type { LayerSettings } from '../state/layers'

const ITEMS: { id: string; label: string; icon: ReactNode }[] = [
  { id: 'layers', label: 'Layers', icon: <LayersIcon /> },
  { id: 'filters', label: 'Filters', icon: <FilterIcon /> },
  { id: 'weather', label: 'Weather', icon: <WeatherIcon /> },
  { id: 'stats', label: 'Stats', icon: <StatsIcon /> },
  { id: 'playback', label: 'Playback', icon: <PlaybackIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

interface Props {
  layers: LayerSettings
  onLayersChange: (next: LayerSettings) => void
  radar: RadarController
}

function BottomDock({ layers, onLayersChange, radar }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close the open menu on Escape or a click outside the dock.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setActive(null)
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setActive(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [active])

  return (
    <div className="dock-wrap" ref={ref}>
      {active === 'layers' && <LayersMenu layers={layers} onChange={onLayersChange} />}
      {active === 'weather' && <WeatherPanel radar={radar} layers={layers} onChange={onLayersChange} />}
      <nav className="dock" aria-label="Map tools">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={active === item.id ? 'active' : ''}
            aria-pressed={active === item.id}
            aria-expanded={item.id === 'layers' || item.id === 'weather' ? active === item.id : undefined}
            onClick={() => setActive(active === item.id ? null : item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default memo(BottomDock)
