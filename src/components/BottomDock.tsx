import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { FilterIcon, LayersIcon, SettingsIcon, StatsIcon, WeatherIcon } from './Icons'
import LayersMenu from './LayersMenu'
import WeatherPanel from './WeatherPanel'
import SettingsPanel from './SettingsPanel'
import StatsPanel from './StatsPanel'
import type { Settings } from '../state/settings'
import type { RadarController } from '../layers/radar'
import type { LayerSettings } from '../state/layers'

const ITEMS: { id: string; label: string; icon: ReactNode }[] = [
  { id: 'layers', label: 'Layers', icon: <LayersIcon /> },
  { id: 'filters', label: 'Filters', icon: <FilterIcon /> },
  { id: 'weather', label: 'Weather', icon: <WeatherIcon /> },
  { id: 'stats', label: 'Stats', icon: <StatsIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

interface Props {
  layers: LayerSettings
  onLayersChange: (next: LayerSettings) => void
  radar: RadarController
  settings: Settings
  onSettingsChange: (next: Settings) => void
  /** A Stats list entry picked: open that airport. */
  onAirport: (icao: string) => void
}

function BottomDock({ layers, onLayersChange, radar, settings, onSettingsChange, onAirport }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close the open menu on Escape or a click outside the dock.
  useEffect(() => {
    if (!active) return
    // A dialog opened from a menu (e.g. "More info") handles its own Escape/clicks.
    const dialogOpen = () => document.querySelector('[data-dock-dialog]') !== null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !dialogOpen() && setActive(null)
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !dialogOpen()) setActive(null)
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
      {active === 'stats' && <StatsPanel
          onAirport={(icao) => {
            setActive(null) // out of the way, so the airport is in view
            onAirport(icao)
          }}
        />}
      {active === 'settings' && <SettingsPanel settings={settings} onChange={onSettingsChange} />}
      <nav className="dock" aria-label="Map tools">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={active === item.id ? 'active' : ''}
            aria-pressed={active === item.id}
            aria-expanded={['layers', 'weather', 'stats', 'settings'].includes(item.id) ? active === item.id : undefined}
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
