// Sun position and day/night geometry.
// Low-precision solar formulas (accurate to ~0.01°), plenty for a map overlay.

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** Point on Earth where the sun is directly overhead at `date`. */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const n = date.getTime() / 86_400_000 - 10_957.5 // days since J2000.0 (2000-01-01 12:00 UTC)
  const L = 280.46 + 0.9856474 * n // mean longitude
  const g = (357.528 + 0.9856003 * n) * RAD // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD // ecliptic longitude
  const epsilon = (23.439 - 0.0000004 * n) * RAD // obliquity of the ecliptic

  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) * DEG
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) * DEG
  const gmst = (18.697374558 + 24.06570982441908 * n) * 15 // Greenwich sidereal time, degrees

  let lon = (ra - gmst) % 360
  if (lon > 180) lon -= 360
  if (lon < -180) lon += 360
  return { lat: dec, lon }
}

/** Web Mercator can't show the poles; keep polygons inside its limits. */
const MAX_LAT = 85.0511

/**
 * Polygon of every point where the sun is below `altitude` degrees.
 * That's a spherical cap around the anti-solar point with angular radius
 * 90° + altitude (e.g. 84° for civil twilight at −6°).
 *
 * Built meridian by meridian: on each line of longitude the cap covers one
 * continuous range of latitudes (or none). Walking east along the top edge
 * and back west along the bottom edge gives the outline. This stays correct
 * when the cap contains a pole or its edge passes close to one, which a
 * simple "trace the circle" approach gets wrong near the equinoxes.
 */
export function nightPolygon(date: Date, altitude: number, stepDeg = 0.5): [number, number][] {
  const sun = subsolarPoint(date)
  const cLat = -sun.lat * RAD
  const cLon = sun.lon + 180
  const k = Math.cos((90 + altitude) * RAD)
  const A = Math.sin(cLat)
  const HALF_PI = Math.PI / 2

  const top: [number, number][] = []
  const bottom: [number, number][] = []
  // Sweep a full circle centred on the cap so its covered longitudes are contiguous.
  for (let d = -180; d <= 180 + 1e-9; d += stepDeg) {
    // Inside the cap: A·sinφ + B·cosφ ≥ k, i.e. R·sin(φ + α) ≥ k
    const B = Math.cos(cLat) * Math.cos(d * RAD)
    const R = Math.hypot(A, B)
    let lo: number, hi: number
    if (k <= -R) {
      lo = -HALF_PI
      hi = HALF_PI
    } else if (k > R) {
      continue // this meridian is entirely in daylight
    } else {
      const alpha = Math.atan2(B, A)
      const s = Math.asin(k / R)
      lo = Infinity
      hi = -Infinity
      for (const shift of [-2 * Math.PI, 0, 2 * Math.PI]) {
        const a = Math.max(s - alpha + shift, -HALF_PI)
        const b = Math.min(Math.PI - s - alpha + shift, HALF_PI)
        if (a <= b && b - a > hi - lo) {
          lo = a
          hi = b
        }
      }
      if (lo > hi) continue
    }
    const lon = cLon + d
    top.push([lon, Math.min(hi * DEG, MAX_LAT)])
    bottom.push([lon, Math.max(lo * DEG, -MAX_LAT)])
  }
  const ring = [...top, ...bottom.reverse()]
  if (ring.length) ring.push(ring[0])
  return ring
}
