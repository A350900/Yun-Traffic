import { useSyncExternalStore } from 'react'
import type { RadarController } from '../layers/radar'
import { CARTOON_BANDS, REALISTIC_LEGEND } from '../layers/radarStyle'
import type { LayerSettings } from '../state/layers'

interface Props {
  radar: RadarController
  layers: LayerSettings
  onChange: (next: LayerSettings) => void
}

const fmtTime = (sec: number) => new Date(sec * 1000).toISOString().slice(11, 16)

function ago(sec: number) {
  const m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`
}

const rgba = ([r, g, b]: number[], a: number) => `rgba(${r}, ${g}, ${b}, ${a})`

export default function WeatherPanel({ radar, layers, onChange }: Props) {
  const s = useSyncExternalStore(radar.subscribe, radar.getState)
  const frame = s.frames[s.index]
  const last = s.frames.length - 1

  return (
    <div className="popover weather-panel" role="dialog" aria-label="Weather radar">
      <label className="toggle-row">
        <span>
          <span className="toggle-label">Weather radar</span>
          <span className="toggle-hint">Rain and storms, past 2 hours</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={layers.radar}
          onChange={(e) => onChange({ ...layers, radar: e.target.checked })}
        />
        <span className="switch" aria-hidden="true" />
      </label>

      {layers.radar && (
        <>
          <div className="radar-time">
            {s.error ? (
              <span className="radar-error">{s.error}</span>
            ) : frame ? (
              <>
                <strong>{fmtTime(frame.time)} UTC</strong>
                <span className="dim"> · {ago(frame.time)}</span>
                {s.loading && <span className="radar-spinner" aria-label="Loading" />}
              </>
            ) : (
              <span className="dim">Loading radar…</span>
            )}
          </div>

          <div className="radar-player">
            <button
              className="play-btn"
              onClick={() => (s.playing ? radar.pause() : radar.play())}
              disabled={s.frames.length < 2}
              aria-label={s.playing ? 'Pause' : 'Play the last 2 hours'}
              title={s.playing ? 'Pause' : 'Play the last 2 hours'}
            >
              {s.playing ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2.5" y="2" width="3.2" height="10" rx="1" /><rect x="8.3" y="2" width="3.2" height="10" rx="1" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3.5 2.2v9.6c0 .6.6.9 1.1.6l7.6-4.8a.7.7 0 0 0 0-1.2L4.6 1.6c-.5-.3-1.1 0-1.1.6Z" /></svg>
              )}
            </button>
            <input
              type="range"
              className="scrubber"
              min={0}
              max={Math.max(0, last)}
              step={1}
              value={Math.max(0, s.index)}
              onChange={(e) => radar.seek(Number(e.target.value))}
              aria-label="Radar time"
              disabled={s.frames.length < 2}
            />
            <span className="scrub-label dim">{s.index === last ? 'Now' : frame ? `−${Math.round((s.frames[last].time - frame.time) / 60)}m` : ''}</span>
          </div>

          <div className="segmented" role="radiogroup" aria-label="Radar style">
            {(['cartoon', 'realistic'] as const).map((style) => (
              <button
                key={style}
                role="radio"
                aria-checked={layers.radarStyle === style}
                className={layers.radarStyle === style ? 'on' : ''}
                onClick={() => onChange({ ...layers, radarStyle: style })}
              >
                {style === 'cartoon' ? 'Cartoon' : 'Realistic'}
              </button>
            ))}
          </div>

          <label className="slider-row">
            <span className="dim">Opacity</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={layers.radarOpacity}
              onChange={(e) => onChange({ ...layers, radarOpacity: Number(e.target.value) })}
            />
          </label>

          {layers.radarStyle === 'cartoon' ? (
            <ul className="radar-legend">
              {CARTOON_BANDS.map((b) => (
                <li key={b.label} title={b.hint}>
                  <span className="swatch" style={{ background: rgba(b.rgb, Math.min(1, b.alpha + 0.25)) }} />
                  {b.label}
                </li>
              ))}
            </ul>
          ) : (
            <div className="radar-legend-bar">
              <span className="bar" style={{ background: `linear-gradient(90deg, ${REALISTIC_LEGEND.join(', ')})` }} />
              <span className="dim">Light</span>
              <span className="dim">Intense</span>
            </div>
          )}

          <p className="credit">
            Radar data ©{' '}
            <a href="https://www.rainviewer.com" target="_blank" rel="noreferrer">
              RainViewer
            </a>
          </p>
        </>
      )}
    </div>
  )
}
