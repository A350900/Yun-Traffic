import { useState, type ReactNode } from 'react'
import { FilterIcon, LayersIcon, PlaybackIcon, SettingsIcon, StatsIcon, WeatherIcon } from './Icons'

const ITEMS: { id: string; label: string; icon: ReactNode }[] = [
  { id: 'layers', label: 'Layers', icon: <LayersIcon /> },
  { id: 'filters', label: 'Filters', icon: <FilterIcon /> },
  { id: 'weather', label: 'Weather', icon: <WeatherIcon /> },
  { id: 'stats', label: 'Stats', icon: <StatsIcon /> },
  { id: 'playback', label: 'Playback', icon: <PlaybackIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

export default function BottomDock() {
  const [active, setActive] = useState<string | null>(null)

  return (
    <nav className="dock" aria-label="Map tools">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={active === item.id ? 'active' : ''}
          aria-pressed={active === item.id}
          onClick={() => setActive(active === item.id ? null : item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
