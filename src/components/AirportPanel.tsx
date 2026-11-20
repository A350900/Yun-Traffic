import { useEffect, useState } from 'react'
import type { AirportPhoto } from '../../shared/wire'
import { majorAirport } from '../layers/airports'
import { zoneLabel } from '../flights/zone'

interface Props {
  icao: string
  now: number
  onClose: () => void
}

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Small card for a busiest-airport pin. A starting point: more to come. */
export default function AirportPanel({ icao, now, onClose }: Props) {
  const a = majorAirport(icao)
  // undefined while loading
  const [photo, setPhoto] = useState<AirportPhoto | undefined>(undefined)
  useEffect(() => {
    setPhoto(undefined)
    const ctrl = new AbortController()
    fetch(`/api/airport-photo/${icao}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<AirportPhoto>) : null))
      .then((p) => setPhoto(p))
      .catch(() => !ctrl.signal.aborted && setPhoto(null))
    return () => ctrl.abort()
  }, [icao])

  if (!a) return null
  const [, iata, name, city, country, , , rank, tz] = a
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now)

  return (
    <aside className="flight-panel airport-panel" aria-label="Selected airport">
      <header>
        <div className="fp-title">
          <h2>{iata}</h2>
          <p className="fp-subtitle">{name}</p>
          <div className="chips">
            <span className="chip">{icao}</span>
            <span className="chip mono">#{rank} busiest</span>
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <section className="route-card airport-facts">
        <div>
          <span className="fact-label">Location</span>
          <span className="fact-value">
            {city}, {countryName(country)}
          </span>
        </div>
        <div>
          <span className="fact-label">Local time</span>
          <span className="fact-value">
            {localTime} <span className="dim">{zoneLabel(tz, now)}</span>
          </span>
        </div>
      </section>

      {photo ? (
        <a className="fp-photo" href={photo.link} target="_blank" rel="noreferrer" title="View on Wikimedia Commons">
          <img src={photo.src} alt={name} loading="lazy" />
          <span className="photo-credit">
            © {photo.author}
            {photo.license && ` · ${photo.license}`} · Wikimedia Commons
          </span>
        </a>
      ) : (
        <div className="fp-photo empty">
          {photo === undefined ? (
            <span className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
          ) : (
            <span>No image</span>
          )}
        </div>
      )}

      <p className="airport-note">Ranked #{rank} worldwide by passengers (approximate 2024 ranking).</p>
    </aside>
  )
}
