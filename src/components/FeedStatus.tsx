import type { FeedStats } from '../../shared/wire'

interface Props {
  count: number
  stats: FeedStats | null
  error: string | null
  now: number
  synthetic: boolean
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
  } else if (!stats?.lastFetch) {
    state = 'warn'
    detail = 'connecting…'
  } else {
    const ago = Math.max(0, Math.round((now - stats.lastFetch) / 1000))
    detail = stats.rateLimited ? 'adsb.lol rate limit, pacing requests' : `updated ${ago}s ago`
    if (stats.rateLimited || ago > 60) state = 'warn'
  }

  return (
    <div
      className={`feed-status ${state}`}
      title={
        stats && !synthetic
          ? `Worldwide sweep by aircraft type takes ~${stats.sweepSeconds}s. Zoom in for complete, fresher regional data.`
          : undefined
      }
    >
      <span className="dot" />
      <strong>{count.toLocaleString()}</strong> aircraft
      <span className="dim"> · {detail}</span>
    </div>
  )
}
