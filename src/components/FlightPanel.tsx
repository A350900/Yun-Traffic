import { F, type AircraftTuple } from '../../shared/wire'

interface Props {
  aircraft: AircraftTuple | undefined
  hex: string
  now: number
  onClose: () => void
}

const fmt = (n: number | null | undefined, unit: string, digits = 0) =>
  n == null ? '—' : `${n.toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`

function altitude(alt: number | null) {
  if (alt === -1) return 'On ground'
  if (alt == null) return '—'
  return alt >= 18000 ? `FL${Math.round(alt / 100)}` : `${alt.toLocaleString()} ft`
}

function age(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`
}

export default function FlightPanel({ aircraft: ac, hex, now, onClose }: Props) {
  return (
    <aside className="flight-panel" aria-label="Selected aircraft">
      <header>
        <div>
          <h2>{ac?.[F.Callsign] ?? ac?.[F.Registration] ?? hex.toUpperCase()}</h2>
          <div className="chips">
            {ac?.[F.Type] && <span className="chip">{ac[F.Type]}</span>}
            {ac?.[F.Registration] && <span className="chip">{ac[F.Registration]}</span>}
            <span className="chip mono">{hex.toUpperCase()}</span>
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </header>

      {ac ? (
        <dl>
          <div><dt>Altitude</dt><dd>{altitude(ac[F.Alt])}</dd></div>
          <div><dt>Ground speed</dt><dd>{fmt(ac[F.Gs], 'kt')}</dd></div>
          <div><dt>Track</dt><dd>{ac[F.Track] == null ? '—' : `${Math.round(ac[F.Track]!)}°`}</dd></div>
          <div><dt>Vertical rate</dt><dd>{fmt(ac[F.VRate], 'ft/min')}</dd></div>
          <div><dt>Squawk</dt><dd>{ac[F.Squawk] ?? '—'}</dd></div>
          <div><dt>Category</dt><dd>{ac[F.Category] ?? '—'}</dd></div>
          <div className="wide">
            <dt>Position</dt>
            <dd>
              {ac[F.Lat].toFixed(3)}, {ac[F.Lon].toFixed(3)}
              <span className="dim"> · {age(now - ac[F.PosTime])}</span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="dim">No longer receiving this aircraft.</p>
      )}
    </aside>
  )
}
