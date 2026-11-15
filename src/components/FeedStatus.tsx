import type { FeedStats } from '../../shared/wire'

interface Props {
  count: number
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
      `OpenSky (worldwide${os.authenticated ? '' : ', anonymous'}): ` +
        (os.error ? os.error : next != null ? `next snapshot in ${next}s` : 'connecting…'),
    )
  }
  lines.push('adsb.fi (region by region, busiest first): live')
  lines.push(
    `adsb.lol (types, registrations, zoomed-in areas): ${stats.rateLimited ? 'pacing requests (rate limit)' : 'live'}`,
  )
  lines.push('Positions between updates are estimated from speed and heading.')
  return lines.join('\n')
}

export default function FeedStatus({ count, stats, error, now, synthetic }: Props) {
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
    }
  }

  return (
    <div
      className={`feed-status ${state}`}
      title={stats && !synthetic ? sourceSummary(stats, now) : undefined}
    >
      <span className="dot" />
      <strong>{count.toLocaleString()}</strong> aircraft
      <span className="dim"> · {detail}</span>
    </div>
  )
}
