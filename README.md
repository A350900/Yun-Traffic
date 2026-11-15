# Yún Traffic

Live flight tracking on a 2D map: MapLibre GL + OpenFreeMap tiles, aircraft data from [adsb.lol](https://adsb.lol).

## Run it

**Easiest:** double-click `start-windows.bat` (Windows) or `start-mac.command` (Mac).
It pulls the latest changes, installs anything new, starts the site and opens
http://localhost:5173. Keep the window open while using the site.

Or by hand:

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

- **No "all aircraft" endpoint exists on adsb.lol**, and it rate-limits hard (~15-request bursts,
  then ~30s cooldown). `server/scheduler.ts` runs one paced request loop that:
  - sweeps the world **by aircraft type** (`/v2/type/B738`, …), polling busy types more often and
    learning new types as it sees them;
  - fetches **everything within 250 nm** of where users are zoomed in (zoom ≥ 5), so the area on
    screen is complete and fresher;
  - backs off on HTTP 429 and speeds up again on success.
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

Map style and logo variant: `src/config/theme.ts`.

Aircraft data © adsb.lol contributors, ODbL. Map © OpenFreeMap / OpenMapTiles / OpenStreetMap.
