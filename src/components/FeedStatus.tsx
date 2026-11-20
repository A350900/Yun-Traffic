import type { FeedStats } from '../../shared/wire'

interface Props {
  count: number
  /** simulated traffic: simulated aircraft currently shown worldwide */
  simulated: number
  stats: FeedStats | null
  error: string | null
  now: number
  synthetic: boolean
}

function sourceSummary(stats: FeedStats, now: number) {
  const lines: string[] = []
  const os = stats.opensky
  if (os?.enabled) {
    const next = os.nextFetch ? Math.max(0, Math.round((os.nextFetch - now) / 1000)) : null
    lines.push(
      `OpenSky — main source, worldwide${os.authenticated ? '' : ' (anonymous)'}: ` +
        (os.error ? os.error : next != null ? `next snapshot in ${next}s` : 'connecting…'),
    )
  }
  const al = stats.airplanesLive
  lines.push(`airplanes.live — fills gaps, region by region: ${al?.error ? al.error : al?.lastFetch ? 'live' : 'connecting…'}`)
  lines.push(
    `adsb.lol — fills gaps, types and zoomed-in areas: ${stats.rateLimited ? 'pacing requests (rate limit)' : 'live'}`,
  )
  lines.push('Faded aircraft: estimated position (no report for 5+ min, e.g. over oceans).')
  lines.push('Positions between updates are estimated from speed and heading.')
  return lines.join('\n')
}

export default function FeedStatus({ count, simulated, stats, error, now, synthetic }: Props) {
  let state: 'live' | 'warn' | 'down' = 'live'
  let detail = ''
  if (synthetic) {
    detail = 'synthetic test data'
    state = 'warn'
  } else if (error) {
    state = 'down'
    detail = 'feed offline'
  } else {
    // Two sources: OpenSky (worldwide snapshots) and adsb.lol (regional detail).
    const last = Math.max(stats?.lastFetch ?? 0, stats?.opensky?.lastFetch ?? 0)
    if (!last) {
      state = 'warn'
      detail = 'connecting…'
    } else {
      const ago = Math.max(0, Math.round((now - last) / 1000))
      detail = ago < 60 ? `updated ${ago}s ago` : `updated ${Math.floor(ago / 60)}m ago`
      if (ago > 180) state = 'warn'
      // The main source being down matters: say so right on the pill.
      if (stats?.opensky?.enabled && stats.opensky.error) {
        state = 'warn'
        detail = 'OpenSky unavailable · hover for details'
      }
    }
  }

  return (
    <div
      className={`feed-status ${state}`}
      title={stats && !synthetic ? sourceSummary(stats, now) : undefined}
    >
      <span className="dot" />
      <strong>{count.toLocaleString()}</strong> aircraft
      {simulated > 0 && (
        <span className="sim-count" title="Simulated traffic: illustrative flights filling coverage gaps (not live data)">
          {' '}+ {simulated.toLocaleString()} simulated
        </span>
      )}
      <span className="dim"> · {detail}</span>
    </div>
  )
}
