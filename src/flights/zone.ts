/** "EST · UTC−05:00" (or just "UTC+09:00" where there's no common abbreviation) */
export function zoneLabel(tz: string | null, now: number) {
  if (!tz) return ''
  try {
    const d = new Date(now)
    const short = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value
    const long = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value
    const offset = (long === 'GMT' ? 'UTC+00:00' : long?.replace('GMT', 'UTC'))?.replace('-', '−')
    return short && !short.startsWith('GMT') && !short.startsWith('UTC') ? `${short} · ${offset}` : offset ?? ''
  } catch {
    return ''
  }
}
