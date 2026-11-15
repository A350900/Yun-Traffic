// World clocks shown in the top bar, left to right. UTC is always shown first.
// Later this list can come from user settings; for now it's fixed here.

export interface ClockConfig {
  /** Short label, usually an airport code */
  label: string
  /** IANA time zone */
  timeZone: string
  /** Full name for the tooltip */
  name: string
}

export const CLOCKS: ClockConfig[] = [
  { label: 'LAX', timeZone: 'America/Los_Angeles', name: 'Los Angeles' },
  { label: 'JFK', timeZone: 'America/New_York', name: 'New York JFK' },
  { label: 'LHR', timeZone: 'Europe/London', name: 'London Heathrow' },
  { label: 'DXB', timeZone: 'Asia/Dubai', name: 'Dubai' },
  { label: 'PVG', timeZone: 'Asia/Shanghai', name: 'Shanghai Pudong' },
  { label: 'HND', timeZone: 'Asia/Tokyo', name: 'Tokyo Haneda' },
]
