import { MAJOR_AIRPORTS } from '../layers/airports'
import { currentMap } from '../state/mapRef'
import largest from '../../data/encyclopedia/largest-airlines.json'

type Airline = [icao: string, name: string, country: string, fleet: number]
const AIRLINES = largest.airlines as Airline[]
const MAX_FLEET = Math.max(...AIRLINES.map((a) => a[3]))
const AIRPORTS = [...MAJOR_AIRPORTS].sort((a, b) => a[7] - b[7])

const regions = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return null
  }
})()
const countryName = (code: string) => regions?.of(code) ?? code

interface Props {
  /** Open an airport's card (the map flies there too). */
  onAirport: (icao: string) => void
}

/** Stats: the world's busiest airports and largest airlines, side by side, each scrolling on its own. */
export default function StatsPanel({ onAirport }: Props) {
  return (
    <div className="popover stats-panel" role="dialog" aria-label="Stats">
      <section className="stats-col" aria-labelledby="stats-airports">
        <h3 id="stats-airports">Busiest airports</h3>
        <p className="stats-hint">By passengers, 2024</p>
        <ol className="stats-list">
          {AIRPORTS.map(([icao, iata, name, city, country, lat, lon, rank]) => (
            <li key={icao}>
              <button
                className="stats-row"
                title={`${name}, ${city}`}
                onClick={() => {
                  currentMap()?.flyTo({ center: [lon, lat], zoom: Math.max(currentMap()?.getZoom() ?? 0, 6), duration: 1600 })
                  onAirport(icao)
                }}
              >
                <span className="stats-rank">{rank}</span>
                <span className="stats-code">{iata}</span>
                <span className="stats-main">
                  <span className="stats-name">{city}</span>
                  <span className="stats-sub">{countryName(country)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className="stats-col" aria-labelledby="stats-airlines">
        <h3 id="stats-airlines">Largest airlines</h3>
        <p className="stats-hint">By fleet size, approximate</p>
        <ol className="stats-list">
          {AIRLINES.map(([icao, name, country, fleet], i) => (
            <li key={icao} className="stats-row" title={`${name} (${icao}): about ${fleet} aircraft`}>
              <span className="stats-rank">{i + 1}</span>
              <span className="stats-main">
                <span className="stats-name">{name}</span>
                <span className="stats-sub">{countryName(country)}</span>
                <span className="stats-bar" style={{ width: `${(fleet / MAX_FLEET) * 100}%` }} aria-hidden="true" />
              </span>
              <span className="stats-value">{fleet.toLocaleString('en-US')}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
