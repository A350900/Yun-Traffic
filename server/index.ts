import './env.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { gzipSync } from 'node:zlib'
import { AircraftStore } from './store.ts'
import { Scheduler } from './scheduler.ts'
import { OpenSkyPoller } from './opensky.ts'
import { AIRPLANES_LIVE, RegionSweep } from './regionSweep.ts'
import { flightInfo, flightPhoto, flightTrace, onTraceRequest } from './flightInfo.ts'
import type { FlightTrace } from '../shared/wire.ts'
import { SimRecorder } from './sim/recorder.ts' // simulated traffic
import type { AircraftResponse } from '../shared/wire.ts'

// Honour HTTPS_PROXY when one is set (e.g. in sandboxed/corporate networks).
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
  setGlobalDispatcher(new EnvHttpProxyAgent())
}

const PORT = Number(process.env.PORT ?? 8787)
const DIST = join(import.meta.dirname, '..', 'dist')

const store = new AircraftStore()
setInterval(() => store.prune(), 15_000) // drop aircraft nobody has reported for 12 min
const scheduler = new Scheduler(store)
if (process.env.ADSBLOL_DISABLED !== '1') scheduler.start()
// A clicked aircraft's flown path comes from adsb.lol too: give it the rate limit.
onTraceRequest(() => scheduler.yieldFor(4000))
const opensky = new OpenSkyPoller(store)
opensky.start()
// Main source: OpenSky (worldwide snapshots). Secondary sources fill in
// aircraft OpenSky doesn't see: airplanes.live (region sweep) and adsb.lol.
const airplanesLive = new RegionSweep(store, AIRPLANES_LIVE)
if (process.env.AIRPLANESLIVE_DISABLED !== '1') airplanesLive.start()

// simulated traffic: records live coverage, totals and airlines (server/sim/)
const SIM_ENABLED = process.env.SIM_DISABLED !== '1'
const simRecorder = new SimRecorder(store)
if (SIM_ENABLED) simRecorder.start()

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  const json = Buffer.from(JSON.stringify(body))
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }
  // Full snapshots of 10k aircraft are ~1MB of JSON; gzip brings that to ~250KB.
  if (json.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    headers['Content-Encoding'] = 'gzip'
    res.writeHead(status, headers).end(gzipSync(json, { level: 4 }))
  } else {
    res.writeHead(status, headers).end(json)
  }
}

function handleAircraft(req: IncomingMessage, res: ServerResponse, url: URL) {
  const sinceParam = url.searchParams.get('since')
  const since = sinceParam != null && sinceParam !== '' ? Number(sinceParam) : null

  // Optional focus hint: the client tells us what it's looking at.
  const focus = url.searchParams.get('focus')
  if (focus) {
    const [lat, lon, r] = focus.split(',').map(Number)
    if ([lat, lon, r].every(Number.isFinite) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && r > 0 && r <= 250) {
      scheduler.requestFocus(lat, lon, r)
    }
  }

  const delta = store.changesSince(Number.isFinite(since) ? since : null)
  const body: AircraftResponse = {
    ...delta,
    now: Date.now(),
    stats: {
      total: store.size,
      lastFetch: Math.max(scheduler.lastFetch ?? 0, airplanesLive.status.lastFetch ?? 0) || null,
      sweepSeconds: scheduler.sweepSeconds,
      rateLimited: scheduler.rateLimited,
      airplanesLive: { lastFetch: airplanesLive.status.lastFetch, error: airplanesLive.status.error },
      opensky: {
        enabled: opensky.status.enabled,
        authenticated: opensky.status.authenticated,
        lastFetch: opensky.status.lastFetch,
        nextFetch: opensky.status.nextFetch,
        error: opensky.status.error,
      },
    },
  }
  send(req, res, 200, body)
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest'])
/** gzip-compressed copies of static files, by path + modification time */
const gzipCache = new Map<string, Buffer>()

/** Serves the built frontend (`npm run build`) in production. */
function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  let file = normalize(join(DIST, decodeURIComponent(pathname)))
  if (!file.startsWith(DIST)) return res.writeHead(403).end()
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) return res.writeHead(404).end('Run `npm run build` first, or use `npm run dev`.')
  const immutable = file.includes(`${join(DIST, 'assets')}`)
  const ext = extname(file)
  const headers: Record<string, string> = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
  }
  // Text files compress ~5x (the simulated-traffic data most of all).
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    const key = `${file}|${statSync(file).mtimeMs}`
    let gz = gzipCache.get(key)
    if (!gz) {
      gz = gzipSync(readFileSync(file), { level: 6 })
      gzipCache.set(key, gz)
    }
    return res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' }).end(gz)
  }
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/api/aircraft') return handleAircraft(req, res, url)
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(req, res, 200, {
      ok: true,
      aircraft: store.size,
      sim: SIM_ENABLED ? simRecorder.status : 'disabled', // simulated traffic
      coverage: store.coverage(),
      history: store.history.size, // recent positions kept for instant flight paths
      adsbLol: { lastFetch: scheduler.lastFetch },
      opensky: opensky.status,
      airplanesLive: airplanesLive.status,
    })
  }
  const detail = url.pathname.match(/^\/api\/(flight|trace|photo)\/([0-9a-f~]{6,7})$/i)
  if (req.method === 'GET' && detail) {
    const hex = detail[2].toLowerCase()
    const ac = store.get(hex)
    const job =
      detail[1] === 'flight'
        ? flightInfo(
            hex,
            (url.searchParams.get('cs') || ac?.[6] || '').trim().toUpperCase() || null,
            ac?.[8] ?? null,
            ac ? [ac[1], ac[2]] : null,
            ac?.[7] ?? ((url.searchParams.get('t') || '').trim().toUpperCase().slice(0, 4) || null),
            ac?.[3] ?? null,
            ac?.[5] ?? null,
            store.history.trace(hex),
          )
        : detail[1] === 'photo'
          ? flightPhoto(hex, ac?.[8] ?? ((url.searchParams.get('reg') || '').trim().toUpperCase().slice(0, 12) || null))
          : (() => {
              // Answer quickly: if adsb.lol's full history isn't back within a
              // moment, send what we've seen ourselves (the panel asks again shortly).
              const local = store.history.trace(hex)
              const remote = flightTrace(hex, local)
              return local ? Promise.race([remote, new Promise<FlightTrace>((r) => setTimeout(() => r(local), 1200))]) : remote
            })()
    job.then(
      (body) => send(req, res, 200, body),
      (err) => send(req, res, 502, { error: (err as Error).message }),
    )
    return
  }
  // simulated traffic: coverage map and recorded totals
  if (SIM_ENABLED && req.method === 'GET' && url.pathname === '/api/sim/coverage') return send(req, res, 200, simRecorder.coverage())
  if (SIM_ENABLED && req.method === 'GET' && url.pathname === '/api/sim/stats') return send(req, res, 200, { series: simRecorder.series() })
  if (url.pathname.startsWith('/api/')) return send(req, res, 404, { error: 'not found' })
  serveStatic(req, res, url.pathname)
}).listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
})
