import type { SVGProps } from 'react'

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

type P = SVGProps<SVGSVGElement>

export const SearchIcon = (p: P) => (
  <svg {...base} width={18} height={18} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
export const MenuIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
)
export const UserIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
)
export const PlusIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
)
export const MinusIcon = (p: P) => (
  <svg {...base} {...p}><path d="M5 12h14" /></svg>
)
export const GlobeIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></svg>
)
export const FlatMapIcon = (p: P) => (
  <svg {...base} {...p}><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2Z" /><path d="M9 4v14M15 6v14" /></svg>
)
export const LocateIcon = (p: P) => (
  <svg {...base} {...p}><path d="m3 11 18-8-8 18-2-8Z" /></svg>
)
export const CompassIcon = (p: P) => (
  <svg {...base} {...p}><path d="m12 3 4 9h-8Z" fill="currentColor" stroke="none" /><path d="m12 21-4-9h8Z" opacity=".4" fill="currentColor" stroke="none" /></svg>
)
export const LayersIcon = (p: P) => (
  <svg {...base} {...p}><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
)
export const FilterIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 5h16l-6 7.5V19l-4 2v-8.5Z" /></svg>
)
export const WeatherIcon = (p: P) => (
  <svg {...base} {...p}><path d="M7 18a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.5 12 3 3 0 0 1 18 18Z" /></svg>
)
export const StatsIcon = (p: P) => (
  <svg {...base} {...p}><path d="M5 20V11M12 20V4M19 20v-6" /></svg>
)
export const PlaybackIcon = (p: P) => (
  <svg {...base} {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 8v4l3 2" /></svg>
)
export const SettingsIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
)
