import { useEffect, useState } from 'react'
import { THEMES, ACTIVE_THEME } from '../config/theme'
import { MenuIcon, SearchIcon, UserIcon } from './Icons'

function useUtcClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now.toISOString().slice(11, 16)
}

export default function TopBar() {
  const utc = useUtcClock()

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="clock" title="Coordinated Universal Time">
          <span className="clock-time">{utc}</span>
          <span className="clock-zone">UTC</span>
        </div>
      </div>

      <a className="brand" href="/" aria-label="Yún Traffic home">
        <img src={THEMES[ACTIVE_THEME].logo} alt="Yún Traffic — Live Flight Tracking" />
      </a>

      <div className="topbar-right">
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Search flights, airports, aircraft" />
          <kbd>/</kbd>
        </label>
        <button className="icon-btn" aria-label="Sign in" title="Sign in"><UserIcon /></button>
        <button className="icon-btn" aria-label="Menu" title="Menu"><MenuIcon /></button>
      </div>
    </header>
  )
}
