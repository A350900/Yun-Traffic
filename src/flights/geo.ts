// Small geodesy helpers (spherical Earth is plenty for display).

const R = Math.PI / 180

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a = Math.sin(((lat2 - lat1) * R) / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(((lon2 - lon1) * R) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Points along the great circle (shortest path) between two positions, as
 * [lon, lat]. Longitudes are unwrapped so the line never jumps across the map
 * at the antimeridian; `startLon` lets it continue an existing line.
 */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number, startLon = lon1): [number, number][] {
  const d = distanceKm(lat1, lon1, lat2, lon2) / 6371
  const n = Math.max(2, Math.min(128, Math.ceil(d * 64)))
  const pts: [number, number][] = []
  let prev = startLon
  for (let i = 0; i <= n; i++) {
    const f = i / n
    let lat: number, lon: number
    if (d < 1e-6) {
      lat = lat1
      lon = lon1
    } else {
      const A = Math.sin((1 - f) * d) / Math.sin(d)
      const B = Math.sin(f * d) / Math.sin(d)
      const x = A * Math.cos(lat1 * R) * Math.cos(lon1 * R) + B * Math.cos(lat2 * R) * Math.cos(lon2 * R)
      const y = A * Math.cos(lat1 * R) * Math.sin(lon1 * R) + B * Math.cos(lat2 * R) * Math.sin(lon2 * R)
      const z = A * Math.sin(lat1 * R) + B * Math.sin(lat2 * R)
      lat = Math.atan2(z, Math.hypot(x, y)) / R
      lon = Math.atan2(y, x) / R
    }
    while (lon - prev > 180) lon -= 360
    while (lon - prev < -180) lon += 360
    prev = lon
    pts.push([lon, lat])
  }
  return pts
}
