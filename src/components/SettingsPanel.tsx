import type { Settings } from '../state/settings'
import { UNIT_SYSTEMS } from '../units'

interface Props {
  settings: Settings
  onChange: (next: Settings) => void
}

export default function SettingsPanel({ settings, onChange }: Props) {
  const active = UNIT_SYSTEMS.find((u) => u.id === settings.units)
  return (
    <div className="popover settings-panel" role="dialog" aria-label="Settings">
      <h3>Units</h3>
      <div className="segmented three" role="radiogroup" aria-label="Units">
        {UNIT_SYSTEMS.map((u) => (
          <button
            key={u.id}
            role="radio"
            aria-checked={settings.units === u.id}
            className={settings.units === u.id ? 'on' : ''}
            onClick={() => onChange({ ...settings, units: u.id })}
          >
            {u.label}
          </button>
        ))}
      </div>
      <p className="settings-hint">{active?.hint}</p>

      {/* simulated traffic */}
      <h3 className="settings-section">Simulated traffic</h3>
      <label className="toggle-row">
        <span>
          <span className="toggle-label">Fill coverage gaps (beta)</span>
          <span className="toggle-hint">
            Illustrative flights on real airline routes where live data can't see (oceans, China, Africa…). Drawn as hollow outlines. Not live data.
          </span>
        </span>
        <input type="checkbox" role="switch" checked={settings.simTraffic} onChange={(e) => onChange({ ...settings, simTraffic: e.target.checked })} />
        <span className="switch" aria-hidden="true" />
      </label>
    </div>
  )
}
