import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { THEMES, ACTIVE_THEME } from '../config/theme'
import { CLOCKS } from '../config/clocks'
import { BookIcon, MenuIcon, RadarIcon, SearchIcon, UserIcon } from './Icons'
import type { AppMode } from '../state/settings'

/** Ticks on each new minute (plus once a second until aligned). */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    const tick = () => {
      const d = new Date()
      setNow(d)
      timer = window.setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50)
    }
    tick()
    return () => clearTimeout(timer)
  }, [])
  return now
}

/** Calendar day number in a zone, for showing "+1" / "−1" against UTC. */
const dayIn = (fmt: Intl.DateTimeFormat, d: Date) => {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day) / 86_400_000
}

function WorldClocks() {
  const now = useMinuteClock()
  const formatters = useMemo(
    () =>
      CLOCKS.map((c) => ({
        ...c,
        time: new Intl.DateTimeFormat('en-GB', { timeZone: c.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
        date: new Intl.DateTimeFormat('en-US', { timeZone: c.timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }),
      })),
    [],
  )
  const utcDate = useMemo(() => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }), [])
  const utcDay = dayIn(utcDate, now)

  return (
    <div className="clocks">
      <div className="clock clock-utc" title="Coordinated Universal Time">
        <span className="clock-label">UTC</span>
        <span className="clock-time">{now.toISOString().slice(11, 16)}</span>
      </div>
      {formatters.map((c) => {
        const diff = dayIn(c.date, now) - utcDay
        return (
          <div className="clock" key={c.label} title={c.name}>
            <span className="clock-label">{c.label}</span>
            <span className="clock-time">
              {c.time.format(now)}
              {diff !== 0 && <sup>{diff > 0 ? `+${diff}` : `−${-diff}`}</sup>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const MODES: { id: AppMode; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'tracking', label: 'Tracking', icon: <RadarIcon width={17} height={17} />, hint: 'Live and simulated flights' },
  { id: 'encyclopedia', label: 'Encyclopedia', icon: <BookIcon width={17} height={17} />, hint: 'The map and its reference layers, without traffic' },
]

/** Tracking / Encyclopedia switch. */
function ModeSwitch({ mode, onChange }: { mode: AppMode; onChange: (m: AppMode) => void }) {
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          className={mode === m.id ? 'on' : ''}
          title={`${m.label}: ${m.hint}`}
          onClick={() => onChange(m.id)}
        >
          {m.icon}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  )
}

function TopBar({ mode, onModeChange }: { mode: AppMode; onModeChange: (m: AppMode) => void }) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Yún Traffic home">
        <img src={THEMES[ACTIVE_THEME].logo} alt="Yún Traffic — Live Flight Tracking" />
      </a>

      <WorldClocks />

      <div className="topbar-right">
        <ModeSwitch mode={mode} onChange={onModeChange} />
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Search" />
          <kbd>/</kbd>
        </label>
        <button className="icon-btn" aria-label="Sign in" title="Sign in"><UserIcon /></button>
        <button className="icon-btn" aria-label="Menu" title="Menu"><MenuIcon /></button>
      </div>
    </header>
  )
}

export default memo(TopBar)
