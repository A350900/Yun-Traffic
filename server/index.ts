import './env.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { gzipSync } from 'node:zlib'
import { AircraftStore } from './store.ts'
import { Scheduler } from './scheduler.ts'
import { OpenSkyPoller } from './opensky.ts'
import { ADSB_FI, RegionSweep } from './regionSweep.ts'
import { flightInfo, flightTrace } from './flightInfo.ts'
import type { AircraftResponse } from '../shared/wire.ts'

// Honour HTTPS_PROXY when one is set (e.g. in sandboxed/corporate networks).
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
  setGlobalDispatcher(new EnvHttpProxyAgent())
}

const PORT = Number(process.env.PORT ?? 8787)
const DIST = join(import.meta.dirname, '..', 'dist')

const store = new AircraftStore()
const scheduler = new Scheduler(store)
scheduler.start()
const opensky = new OpenSkyPoller(store)
opensky.start()
const adsbFi = new RegionSweep(store, ADSB_FI)
if (process.env.ADSBFI_DISABLED !== '1') adsbFi.start()

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
      lastFetch: Math.max(scheduler.lastFetch ?? 0, adsbFi.status.lastFetch ?? 0) || null,
      sweepSeconds: scheduler.sweepSeconds,
      rateLimited: scheduler.rateLimited,
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

/** Serves the built frontend (`npm run build`) in production. */
function serveStatic(res: ServerResponse, pathname: string) {
  let file = normalize(join(DIST, decodeURIComponent(pathname)))
  if (!file.startsWith(DIST)) return res.writeHead(403).end()
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) return res.writeHead(404).end('Run `npm run build` first, or use `npm run dev`.')
  const immutable = file.includes(`${join(DIST, 'assets')}`)
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/api/aircraft') return handleAircraft(req, res, url)
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(req, res, 200, {
      ok: true,
      aircraft: store.size,
      adsbLol: { lastFetch: scheduler.lastFetch },
      opensky: opensky.status,
      adsbFi: adsbFi.status,
    })
  }
  const detail = url.pathname.match(/^\/api\/(flight|trace)\/([0-9a-f~]{6,7})$/i)
  if (req.method === 'GET' && detail) {
    const hex = detail[2].toLowerCase()
    const ac = store.get(hex)
    const job =
      detail[1] === 'flight'
        ? flightInfo(hex, (url.searchParams.get('cs') || ac?.[6] || '').trim().toUpperCase() || null, ac?.[8] ?? null, ac ? [ac[1], ac[2]] : null)
        : flightTrace(hex)
    job.then(
      (body) => send(req, res, 200, body),
      (err) => send(req, res, 502, { error: (err as Error).message }),
    )
    return
  }
  if (url.pathname.startsWith('/api/')) return send(req, res, 404, { error: 'not found' })
  serveStatic(res, url.pathname)
}).listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
})
