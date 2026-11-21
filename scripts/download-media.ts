// Download every airline logo and airport photo now (instead of waiting for the
// server to do it in the background), so the app works offline:
//   npm run media:download
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
  setGlobalDispatcher(new EnvHttpProxyAgent())
}
const { ensureMedia, mediaIndex, mediaFile } = await import('../server/media.ts')

const airlines = Object.fromEntries(
  Object.values(JSON.parse(readFileSync(join(ROOT, 'data', 'encyclopedia', 'country-airlines.json'), 'utf8')).countries as [string, string][][]).flat(),
)
const airports = Object.fromEntries(
  (JSON.parse(readFileSync(join(ROOT, 'data', 'major-airports.json'), 'utf8')).airports as string[][]).map((a) => [a[0], a[2]]),
)
await ensureMedia('airline-logos', airlines)
await ensureMedia('airport-photos', airports)
const count = (kind: 'airline-logos' | 'airport-photos', codes: string[]) => codes.filter((c) => mediaFile(kind, c)).length
console.log(`airline logos: ${count('airline-logos', Object.keys(airlines))} of ${Object.keys(airlines).length}`)
console.log(`airport photos: ${count('airport-photos', Object.keys(airports))} of ${Object.keys(airports).length}`)
const missing = Object.keys(airlines).filter((c) => !mediaFile('airline-logos', c))
if (missing.length) console.log('no logo on Wikimedia (shown as text):', missing.map((c) => `${c} ${airlines[c]}`).join(', '))
void mediaIndex
