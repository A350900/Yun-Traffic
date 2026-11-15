import { F, type AircraftTuple } from '../../shared/wire'

/** Don't dead-reckon further than this; beyond it the guess gets too wrong. */
export const MAX_EXTRAPOLATE_MS = 4 * 60_000

/**
 * Dead reckoning: project the last known position forward along its track
 * at its ground speed. Positions from the API are seconds-to-minutes old,
 * so this keeps aircraft moving smoothly between updates.
 */
export function extrapolate(ac: AircraftTuple, now: number): [number, number] {
  const lat = ac[F.Lat]
  const lon = ac[F.Lon]
  const gs = ac[F.Gs]
  const track = ac[F.Track]
  if (gs == null || track == null || gs < 30) return [lon, lat]
  const dt = Math.min(Math.max(now - ac[F.PosTime], 0), MAX_EXTRAPOLATE_MS)
  const distNm = (gs * dt) / 3_600_000
  const rad = (track * Math.PI) / 180
  const newLat = lat + (distNm * Math.cos(rad)) / 60
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  let newLon = lon + (distNm * Math.sin(rad)) / (60 * cosLat)
  if (newLon > 180) newLon -= 360
  else if (newLon < -180) newLon += 360
  return [newLon, Math.max(-89.9, Math.min(89.9, newLat))]
}
