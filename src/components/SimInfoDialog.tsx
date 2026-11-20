import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/** "More info" about simulated traffic: why it exists and what it is (and isn't). */
export default function SimInfoDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="dialog-backdrop" data-dock-dialog onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="sim-info-title">
        <button className="dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2 id="sim-info-title">About simulated traffic</h2>

        <h4>Why it exists</h4>
        <p>
          Yún Traffic runs on free, community flight data (OpenSky Network and adsb.lol). It comes from ground receivers run by
          volunteers, and each one only hears aircraft within a few hundred kilometres. Over the oceans, the poles and large
          regions with few receivers (much of China, Russia, Africa, South America and the Middle East) nobody is listening.
        </p>
        <p>
          Commercial trackers fill those gaps with satellite tracking, which is a paid service. Without it, those areas would look
          empty even though thousands of flights are crossing them. Simulated traffic gives a realistic picture of what's up there.
        </p>

        <h4>How it works</h4>
        <ul>
          <li>Real airlines, routes and aircraft types, flown on great-circle paths at realistic speeds and altitudes.</li>
          <li>
            Timed like real schedules: by local time of day, weekday and season, such as the overnight transatlantic and transpacific
            waves.
          </li>
          <li>Calibrated to published traffic figures (IATA, Eurocontrol, FAA, CAAC and others).</li>
          <li>
            Only shown inside set regions, and only to fill the difference: where live aircraft are already visible, simulated ones
            step back.
          </li>
          <li>Runs in real time on a repeatable schedule, so everyone sees the same simulated sky at the same moment.</li>
        </ul>

        <h4>What it isn't</h4>
        <p>
          These are not real flights. They have no flight numbers, and their positions are illustrative. Simulated aircraft are drawn
          as hollow outlines so you can always tell them apart from live ones. You can turn them off at any time in Settings.
        </p>
      </div>
    </div>,
    document.body,
  )
}
