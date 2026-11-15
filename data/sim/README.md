# Simulated traffic data

Inputs for the **simulated traffic** feature (fills gaps in live coverage with
believable, clearly-marked illustrative flights). Everything here can be edited
and rebuilt.

| File | What | Rebuild / edit |
|---|---|---|
| `routes.json` | Airline route network: airlines, routes (airline, departure, arrival, aircraft types) and aircraft model names | `node scripts/sim/build-routes.mjs` (add `--live http://localhost:8787` to also use the running app's live airlines) |
| `airline-fixes.json` | Airlines that closed (routes dropped), merged (routes moved to the successor), and per-country code fixes for airlines OpenFlights lacks | Edit by hand, then rebuild `routes.json` |
| `airlines-seen.json` | Airline callsign prefixes seen flying in live data; such airlines are always kept | Updated by the build script |
| `traffic-model.json` | Global airborne targets, monthly factors per region, weekday factors, departure-time profiles. Each value marked *source* or *estimate* | Edit by hand |
| `coverage-seed.json` | Starting coverage map for fresh installs (used until the server has recorded a day of its own) | `node scripts/sim/build-coverage-seed.mjs http://localhost:8787` |

## Licence of the route data

`routes.json` is derived from the [OpenFlights](https://openflights.org/data)
airline, route, airport and plane databases, which are made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
`routes.json` (and `airlines-seen.json`, `airline-fixes.json` as part of the
derived database) is therefore also under the **ODbL 1.0**, with attribution to
OpenFlights. The route data was last updated by its source in June 2014; it is
cleaned here as described above and is used for illustration only.
