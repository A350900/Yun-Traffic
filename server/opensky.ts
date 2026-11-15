import type { AircraftTuple } from '../shared/wire.ts'
import type { AircraftStore } from './store.ts'

/**
 * OpenSky Network: the only free source with a worldwide "every aircraft in
 * one request" endpoint (/states/all). Each global request costs 4 API credits:
 *
 *   anonymous            400 credits/day  -> a snapshot every ~4 min
 *   free account         4000 credits/day -> every ~90 s
 *   active data feeder   8000 credits/day -> every ~45 s
 *
 * We pace requests from the "credits remaining" header so we never run out.
 * Credentials (an OpenSky API client) come from OPENSKY_CLIENT_ID /
 * OPENSKY_CLIENT_SECRET, normally in the local `.env` file (`yun opensky`).
 *
 * Note: OpenSky data is for non-commercial use under their terms.
 */

const API = 'https://opensky-network.org/api/states/all?extended=1'
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
const CREDITS_PER_CALL = 4
const MIN_INTERVAL_S = Number(process.env.OPENSKY_MIN_INTERVAL_S ?? 45)
const MAX_INTERVAL_S = 30 * 60

const M_TO_FT = 3.28084
const MS_TO_KT = 1.943844
const MS_TO_FPM = 196.8504

// OpenSky's numeric emitter category -> ADS-B category code used elsewhere.
const CATEGORY: Record<number, string> = {
  2: 'A1', 3: 'A2', 4: 'A3', 5: 'A4', 6: 'A5', 7: 'A6', 8: 'A7',
  9: 'B1', 10: 'B2', 11: 'B3', 12: 'B4', 14: 'B6', 15: 'B7',
  16: 'C1', 17: 'C2', 18: 'C3', 19: 'C3', 20: 'C3',
}

type State = [
  icao24: string, callsign: string | null, origin: string, timePosition: number | null, lastContact: number,
  lon: number | null, lat: number | null, baroAlt: number | null, onGround: boolean, velocity: number | null,
  track: number | null, vrate: number | null, sensors: unknown, geoAlt: number | null, squawk: string | null,
  spi: boolean, source: number, category?: number,
]

function toTuple(s: State): AircraftTuple | null {
  if (s[5] == null || s[6] == null) return null
  const altM = s[7] ?? s[13]
  const cs = s[1]?.trim()
  return [
    s[0].toLowerCase(),
    Math.round(s[6] * 1e5) / 1e5,
    Math.round(s[5] * 1e5) / 1e5,
    s[10],
    s[9] != null ? Math.round(s[9] * MS_TO_KT) : null,
    s[8] ? -1 : altM != null ? Math.round((altM * M_TO_FT) / 25) * 25 : null,
    cs || null,
    null, // aircraft type: OpenSky's live data doesn't include it (filled from adsb.lol when known)
    null, // registration: same
    (s[3] ?? s[4]) * 1000,
    s[14],
    s[17] != null ? (CATEGORY[s[17]] ?? null) : null,
    s[11] != null ? Math.round((s[11] * MS_TO_FPM) / 64) * 64 : null,
  ]
}

export interface OpenSkyStatus {
  enabled: boolean
  authenticated: boolean
  lastFetch: number | null
  lastCount: number
  creditsRemaining: number | null
  nextFetch: number | null
  error: string | null
}

export class OpenSkyPoller {
  status: OpenSkyStatus = {
    enabled: process.env.OPENSKY_DISABLED !== '1',
    authenticated: false,
    lastFetch: null,
    lastCount: 0,
    creditsRemaining: null,
    nextFetch: null,
    error: null,
  }
  private token: { value: string; expires: number } | null = null
  private clientId = process.env.OPENSKY_CLIENT_ID?.trim()
  private clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim()
  private store: AircraftStore
  private timer: NodeJS.Timeout | null = null

  constructor(store: AircraftStore) {
    this.store = store
  }

  get hasCredentials() {
    return Boolean(this.clientId && this.clientSecret)
  }

  start() {
    if (!this.status.enabled) return
    console.log(`[opensky] ${this.hasCredentials ? 'using your API client' : 'anonymous (run "yun opensky" to add your account)'}`)
    void this.loop()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
  }

  private schedule(seconds: number) {
    const s = Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, seconds))
    this.status.nextFetch = Date.now() + s * 1000
    this.timer = setTimeout(() => void this.loop(), s * 1000)
  }

  /** Spread the remaining credits evenly over what's left of the UTC day. */
  private paceFromCredits(remaining: number) {
    const now = new Date()
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    const secondsLeft = (midnight - now.getTime()) / 1000
    const callsLeft = Math.floor(remaining / CREDITS_PER_CALL)
    return callsLeft > 0 ? secondsLeft / callsLeft : secondsLeft + 60
  }

  private async getToken(): Promise<string | null> {
    if (!this.hasCredentials) return null
    if (this.token && Date.now() < this.token.expires) return this.token.value
    const basic = Buffer.from(`${encodeURIComponent(this.clientId!)}:${encodeURIComponent(this.clientSecret!)}`).toString('base64')
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`OpenSky login failed (HTTP ${res.status}). Check your client ID/secret with "yun opensky". ${text.slice(0, 120)}`)
    }
    const body = (await res.json()) as { access_token: string; expires_in: number }
    // Refresh a minute early so a request never goes out with an expired token.
    this.token = { value: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 }
    return this.token.value
  }

  private async loop() {
    try {
      const token = await this.getToken()
      this.status.authenticated = Boolean(token)
      const res = await fetch(API, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(60_000),
      })
      const remaining = res.headers.get('x-rate-limit-remaining')
      if (remaining != null) this.status.creditsRemaining = Number(remaining)

      if (res.status === 429) {
        await res.body?.cancel()
        const retry = Number(res.headers.get('x-rate-limit-retry-after-seconds')) || 3600
        this.status.error = `out of OpenSky credits for now; next try in ${Math.round(retry / 60)} min`
        console.warn(`[opensky] ${this.status.error}`)
        return this.schedule(retry)
      }
      if (res.status === 401) {
        await res.body?.cancel()
        this.token = null
        throw new Error('OpenSky rejected the login token (HTTP 401)')
      }
      if (!res.ok) {
        await res.body?.cancel()
        throw new Error(`OpenSky HTTP ${res.status}`)
      }

      const body = (await res.json()) as { time: number; states: State[] | null }
      let count = 0
      for (const s of body.states ?? []) {
        const t = toTuple(s)
        if (t) {
          this.store.upsert(t, 'opensky')
          count++
        }
      }
      this.status.lastFetch = Date.now()
      this.status.lastCount = count
      this.status.error = null
      const next = this.status.creditsRemaining != null ? this.paceFromCredits(this.status.creditsRemaining) : 90
      console.log(`[opensky] ${count} aircraft; ${this.status.creditsRemaining ?? '?'} credits left; next in ${Math.round(Math.max(MIN_INTERVAL_S, next))}s`)
      this.schedule(next)
    } catch (err) {
      this.status.error = (err as Error).message
      console.warn(`[opensky] ${this.status.error}`)
      this.schedule(120)
    }
  }
}
