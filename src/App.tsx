import GlobeMap from './components/GlobeMap'
import TopBar from './components/TopBar'
import BottomDock from './components/BottomDock'

export default function App() {
  return (
    <main className="app">
      <GlobeMap />
      <TopBar />
      <BottomDock />
    </main>
  )
}
