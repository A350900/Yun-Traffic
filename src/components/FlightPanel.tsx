import { useSyncExternalStore } from 'react'
import { F, type AircraftTuple, type AirportInfo } from '../../shared/wire'
import type { SelectionStore } from '../flights/selection'
import { zoneLabel } from '../flights/zone'
import { distanceKm } from '../flights/geo'
import { ESTIMATED_AFTER_MS, extrapolate } from '../flights/position'
import { ALTITUDE_STOPS } from '../flights/pathLayer'
import type { UnitSystem } from '../state/settings'
import { altitudeLegend, fmtAltitude, fmtDistance, fmtSpeed, fmtVerticalRate } from '../units'

interface Props {
  aircraft: AircraftTuple | undefined
  hex: string
  now: number
  selection: SelectionStore
  units: UnitSystem
  onClose: () => void
}

function age(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`
}

/** "3:21" style hours:minutes */
function hm(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

function AirportSide({ a, now, align }: { a: AirportInfo | null; now: number; align: 'left' | 'right' }) {
  if (!a)
    return (
      <div className={`route-end ${align} unknown`}>
        <span className="route-code">???</span>
        <span className="route-city">Destination unknown</span>
        <span className="route-tz" />
      </div>
    )
  return (
    <div className={`route-end ${align}`} title={a.name}>
      <span className="route-code">{a.iata ?? a.icao}</span>
      <span className="route-city">{a.city || a.name}</span>
      <span className="route-tz">{zoneLabel(a.tz, now)}</span>
    </div>
  )
}

const PLANE_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5Z" transform="rotate(90 12 12)" />
  </svg>
)

export default function FlightPanel({ aircraft: ac, hex, now, selection, units, onClose }: Props) {
  const sel = useSyncExternalStore(selection.subscribe, selection.getState)
  const info = sel.info?.hex === hex ? sel.info : null
  const trace = sel.trace?.hex === hex ? sel.trace : null
  const loading = sel.infoLoading && !info

  const callsign = ac?.[F.Callsign] ?? info?.callsign ?? ac?.[F.Registration] ?? hex.toUpperCase()
  const typeCode = ac?.[F.Type] ?? info?.aircraft.typeCode
  const reg = ac?.[F.Registration] ?? info?.aircraft.registration
  const subtitle = [info?.airline?.name, info?.aircraft.name ?? typeCode].filter(Boolean)

  // Progress along the route, from the aircraft's current (estimated) position.
  // A route that doesn't match where the aircraft is would only mislead: show it as unknown.
  const listedRoute = info?.route ?? null
  const route = listedRoute?.plausible ? listedRoute : null
  let progress: { flownKm: number; leftKm: number; frac: number; elapsed: string | null; eta: string | null } | null = null
  if (route?.destination && ac) {
    const [lon, lat] = extrapolate(ac, now)
    const flownKm = distanceKm(route.origin.lat, route.origin.lon, lat, lon)
    const leftKm = distanceKm(lat, lon, route.destination.lat, route.destination.lon)
    const gs = ac[F.Gs]
    const airborne = ac[F.Alt] !== -1 && gs != null && gs > 60
    progress = {
      flownKm,
      leftKm,
      frac: Math.min(1, Math.max(0, flownKm / (flownKm + leftKm || 1))),
      elapsed: trace?.takeoff ? hm(now - trace.takeoff) : null,
      eta: airborne ? hm((leftKm / (gs * 1.852)) * 3_600_000) : null,
    }
  }

  return (
    <aside className="flight-panel" aria-label="Selected aircraft">
      <header>
        <div className="fp-title">
          <h2>{callsign}</h2>
          <p className="fp-subtitle">
            {loading ? <span className="skeleton" style={{ width: 190 }} /> : subtitle.join(' | ') || 'Unknown aircraft'}
          </p>
          <div className="chips">
            {typeCode && <span className="chip">{typeCode}</span>}
            {reg && <span className="chip">{reg}</span>}
            <span className="chip mono">{hex.toUpperCase()}</span>
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </header>

      {/* Route */}
      <section className="route-card">
        {route ? (
          <>
            <div className="route-ends">
              <AirportSide a={route.origin} now={now} align="left" />
              <span className="route-plane">{PLANE_ICON}</span>
              <AirportSide a={route.destination} now={now} align="right" />
            </div>
            {progress && (
              <div className="route-progress">
                <div className="bar">
                  <div className="fill" style={{ width: `${progress.frac * 100}%` }} />
                  <span className="bar-plane" style={{ left: `${progress.frac * 100}%` }}>{PLANE_ICON}</span>
                </div>
                <div className="bar-labels">
                  <span>
                    {fmtDistance(progress.flownKm, units)}{progress.elapsed && `, ${progress.elapsed} ago`}
                  </span>
                  <span>
                    {fmtDistance(progress.leftKm, units)}{progress.eta && `, in ${progress.eta}`}
                  </span>
                </div>
              </div>
            )}
            {!sel.originChecked && <p className="route-note info checking">Checking departure airport…</p>}
            {route.originCorrected && <p className="route-note info">Departure airport taken from where this aircraft took off.</p>}
            {route.reversed && <p className="route-note info">Shown the right way round: this flight number is listed for the return leg.</p>}
            {!route.destination && (
              <p className="route-note info">
                Departure taken from where this aircraft took off.
                {route.listed &&
                  ` The listed route (${route.listed.origin.iata ?? route.listed.origin.icao} → ${route.listed.destination.iata ?? route.listed.destination.icao}) doesn't match this flight, so the destination is unknown.`}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="route-empty">{loading ? <span className="skeleton" style={{ width: 160 }} /> : 'Route not available'}</p>
            {listedRoute && (
              <p className="route-note">
                Listed as {listedRoute.origin.iata ?? listedRoute.origin.icao} → {listedRoute.destination?.iata ?? listedRoute.destination?.icao ?? "?"}, but
                that doesn't match where this aircraft is (flight numbers get reused), so it's likely out of date.
              </p>
            )}
          </>
        )}
      </section>

      {/* Photo */}
      {sel.hex === hex && sel.photo ? (
        <a className="fp-photo" href={sel.photo.link} target="_blank" rel="noreferrer" title="View on Planespotters.net">
          <img src={sel.photo.src} alt={`${reg ?? ''} ${info?.aircraft.name ?? ''}`.trim()} loading="lazy" />
          <span className="photo-credit">© {sel.photo.photographer} · Planespotters.net</span>
        </a>
      ) : (
        <div className="fp-photo empty">
          {sel.hex === hex && sel.photo === undefined ? (
            <span className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
          ) : (
            <>
              <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5Z" />
              </svg>
              <span>No image</span>
            </>
          )}
        </div>
      )}

      {ac ? (
        <dl>
          <div><dt>Altitude</dt><dd>{fmtAltitude(ac[F.Alt], units)}</dd></div>
          <div><dt>Ground speed</dt><dd>{fmtSpeed(ac[F.Gs], units)}</dd></div>
          <div><dt>Track</dt><dd>{ac[F.Track] == null ? '—' : `${Math.round(ac[F.Track]!)}°`}</dd></div>
          <div><dt>Vertical rate</dt><dd>{fmtVerticalRate(ac[F.VRate], units)}</dd></div>
          <div><dt>Squawk</dt><dd>{ac[F.Squawk] ?? '—'}</dd></div>
          <div><dt>Category</dt><dd>{ac[F.Category] ?? '—'}</dd></div>
          <div className="wide">
            <dt>Position</dt>
            <dd>
              {ac[F.Lat].toFixed(3)}, {ac[F.Lon].toFixed(3)}
              <span className="dim">
                {' '}· {age(now - ac[F.PosTime])}
                {now - ac[F.PosTime] > ESTIMATED_AFTER_MS && ' · estimated'}
              </span>
            </dd>
          </div>
          {trace && trace.points.length > 1 && (
            <div className="wide">
              <dt>Path colour = altitude</dt>
              <dd className="alt-legend">
                <span
                  className="alt-bar"
                  style={{ background: `linear-gradient(90deg, ${ALTITUDE_STOPS.map(([, c]) => c).join(', ')})` }}
                />
                <span className="alt-labels dim">
                  {altitudeLegend(units).map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                </span>
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="dim">No longer receiving this aircraft.</p>
      )}
    </aside>
  )
}
