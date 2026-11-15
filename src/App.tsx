import { useCallback, useEffect, useRef, useState } from 'react'
import FlightMap from './components/FlightMap'
import TopBar from './components/TopBar'
import BottomDock from './components/BottomDock'
import FlightPanel from './components/FlightPanel'
import FeedStatus from './components/FeedStatus'
import type { FeedState } from './flights/feed'
import { useLayerSettings } from './state/layers'

const synthetic = new URLSearchParams(location.search).has('stress')

export default function App() {
  const [selected, setSelected] = useState<string | null>(null)
  const [layers, setLayers] = useLayerSettings()
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

  return (
    <main className="app">
      <FlightMap selected={selected} onSelect={setSelected} onFeed={onFeed} dayNight={layers.dayNight} />
      <TopBar />
      {selected && (
        <FlightPanel
          hex={selected}
          aircraft={feed?.aircraft.get(selected)}
          now={serverNow}
          onClose={() => setSelected(null)}
        />
      )}
      <FeedStatus
        count={feed?.aircraft.size ?? 0}
        stats={feed?.stats ?? null}
        error={feed?.error ?? null}
        now={serverNow}
        synthetic={synthetic}
      />
      <BottomDock layers={layers} onLayersChange={setLayers} />
    </main>
  )
}
