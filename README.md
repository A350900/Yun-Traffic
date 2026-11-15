# Yún Traffic

Live flight tracking on a 2D map: MapLibre GL + OpenFreeMap tiles, aircraft data from [adsb.lol](https://adsb.lol).

## Run it on your computer

**The `yun` command (recommended).** One time per computer, after cloning,
double-click `setup-windows.bat` (Windows) or `setup-mac.command` (Mac). Then, in any
new Command Prompt / Terminal window:

```bash
yun start     # starts in the background, then open http://localhost:5173
yun stop      # stops it and frees its memory (~380 MB while running)
yun status
yun update    # pull the latest changes from GitHub right now
yun opensky   # save your OpenSky API client (worldwide updates every ~90s instead of ~8 min)
```

While running it also pulls new commits from GitHub every 30 seconds; the page updates itself.
If you move the folder, run setup again. `node scripts/yun.mjs remove` uninstalls the
command. Logs: `logs/autorun.log`.

**By hand:**

```bash
npm install
npm run dev        # API on :8787 + Vite on :5173 (open http://localhost:5173)
```

Production:

```bash
npm run build
npm start          # serves the built site and the API on :8787 (PORT to change)
```

## How it works

```
adsb.lol API ──► server/ (paced poller + in-memory store) ──► /api/aircraft (deltas, gzip)
                                                                   │
                       browser: poll every 3s ──► dead-reckon positions every 1s
                                                 ──► GeoJSON source ──► WebGL symbol layer
```

- **Two data sources, merged by aircraft (ICAO hex), newest position wins:**
  - **OpenSky Network** (`server/opensky.ts`): one `/states/all` request returns every aircraft
    worldwide. Paced from OpenSky's "credits remaining" header so the daily allowance is never
    exceeded: ~every 8 min anonymous, ~90 s with a free account (`yun opensky`).
  - **adsb.lol** (`server/scheduler.ts`): no "all aircraft" endpoint and strict rate limits, so a
    paced loop sweeps the world **by aircraft type** (which also supplies type + registration,
    which OpenSky lacks) and fetches **everything within 250 nm** of where users are zoomed in.
  - **adsb.fi** (`server/regionSweep.ts`): 250 nm area queries at its 1 request/second limit. The
    world (56°S–72°N) is tiled into ~1,140 overlapping circles, visited busiest-first using
    OpenSky's snapshot as a density map; busy regions come round every few minutes.
  - airplanes.live was evaluated but requires contacting them for API access.
- Type/registration are remembered per aircraft for 24 h and filled into OpenSky positions.
- `/api/aircraft?since=<version>` returns only aircraft that changed since the client's last poll.
- The browser projects each aircraft forward along its track at its ground speed (max 4 min),
  so planes keep moving between updates.
- Aircraft are drawn by a MapLibre **symbol layer** (WebGL, no DOM markers) with collision
  detection off. Tested with 20,000 synthetic aircraft: about 3–4 ms of main-thread work per
  1-second update.

### Useful URLs

- `/#7/51.47/-0.45` — the map view lives in the URL hash (zoom/lat/lon).
- `/?stress=20000` — synthetic traffic for load-testing the renderer.
- `/api/health` — server status.

### Config

| Env var | Default | |
|---|---|---|
| `PORT` | `8787` | API/server port |
| `POLL_INTERVAL_MS` | `4000` | Fastest pace for adsb.lol requests |
| `ADSB_API_BASE` | `https://api.adsb.lol` | Upstream API |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | – | OpenSky API client (put in `.env`; `yun opensky` does this) |
| `OPENSKY_MIN_INTERVAL_S` | `45` | Never poll OpenSky faster than this |
| `OPENSKY_DISABLED` | – | Set to `1` to turn OpenSky off |
| `ADSBFI_INTERVAL_MS` | `1100` | Pace of adsb.fi requests (their limit is 1/s) |
| `ADSBFI_DISABLED` | – | Set to `1` to turn adsb.fi off |

Map style and logo variant: `src/config/theme.ts`.

Aircraft data © adsb.lol contributors (ODbL), The OpenSky Network and [adsb.fi](https://adsb.fi) (non-commercial use). Map © OpenFreeMap / OpenMapTiles / OpenStreetMap.
