import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import FlightMap from './components/FlightMap'
import TopBar from './components/TopBar'
import BottomDock from './components/BottomDock'
import FlightPanel from './components/FlightPanel'
import FeedStatus from './components/FeedStatus'
import type { FeedState } from './flights/feed'
import { useLayerSettings } from './state/layers'
import { useSettings } from './state/settings'
import { RadarController } from './layers/radar'
import { SelectionStore } from './flights/selection'
import { SimController } from './sim/client' // simulated traffic
import { F } from '../shared/wire'

const synthetic = new URLSearchParams(location.search).has('stress')

export default function App() {
  const [selected, setSelected] = useState<string | null>(null)
  const [layers, setLayers] = useLayerSettings()
  const [settings, setSettings] = useSettings()
  const [selection] = useState(() => new SelectionStore())
  const [sim] = useState(() => new SimController()) // simulated traffic
  const simShown = useSyncExternalStore(sim.subscribe, () => (settings.simTraffic ? (sim.stats?.shown ?? 0) : 0))
  const [radar] = useState(
    () => new RadarController({ visible: layers.radar, style: layers.radarStyle, opacity: layers.radarOpacity }),
  )
  useEffect(() => radar.setVisible(layers.radar), [radar, layers.radar])
  useEffect(() => radar.setStyle(layers.radarStyle), [radar, layers.radarStyle])
  useEffect(() => radar.setOpacity(layers.radarOpacity), [radar, layers.radarOpacity])
  const feedRef = useRef<FeedState | null>(null)
  // Re-render the overlays once a second (clock-style), not on every data change.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const onFeed = useCallback((s: FeedState) => {
    feedRef.current = s
  }, [])

  const feed = feedRef.current
  const serverNow = now + (feed?.clockOffset ?? 0)
  const selectedAc = selected ? feed?.aircraft.get(selected) : undefined
  const selectedCallsign = selectedAc?.[F.Callsign] || null
  const selectedType = selectedAc?.[F.Type] || null
  useEffect(
    () => selection.select(selected, selectedCallsign, selectedType),
    // Only refetch when the aircraft or its callsign changes, not when the type arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, selected, selectedCallsign],
  )

  return (
    <main className="app">
      <FlightMap onSelect={setSelected} onFeed={onFeed} dayNight={layers.dayNight} radar={radar} selection={selection} sim={sim} simEnabled={settings.simTraffic} simShowAreas={settings.simShowAreas} />
      <TopBar />
      {selected && (
        <FlightPanel
          hex={selected}
          aircraft={feed?.aircraft.get(selected)}
          now={serverNow}
          selection={selection}
          units={settings.units}
          onClose={() => setSelected(null)}
        />
      )}
      <FeedStatus
        count={feed?.aircraft.size ?? 0}
        simulated={simShown}
        stats={feed?.stats ?? null}
        error={feed?.error ?? null}
        now={serverNow}
        synthetic={synthetic}
      />
      <BottomDock layers={layers} onLayersChange={setLayers} radar={radar} settings={settings} onSettingsChange={setSettings} />
    </main>
  )
}
