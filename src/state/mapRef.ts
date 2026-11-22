import type { Map as MLMap } from 'maplibre-gl'

/** The map, for panels that move it (e.g. Stats: go to an airport). Set once the map is created. */
let current: MLMap | null = null
export const setCurrentMap = (map: MLMap | null) => void (current = map)
export const currentMap = () => current
