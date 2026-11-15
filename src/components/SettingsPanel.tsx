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

      <h3 className="settings-section">Estimated aircraft</h3>
      <p className="settings-hint">Drawn as hollow outlines. Live data always replaces them.</p>
      {(
        [
          ['ghostsContinued', 'Continue out of coverage', 'Real flights keep moving along their route to the destination after receivers lose them (e.g. over oceans).'],
          ['ghostsSimulated', 'Simulated from yesterday', "Yesterday's flights at this time, shifted 24 h, where there's no live coverage. Not live data."],
        ] as const
      ).map(([key, label, hint]) => (
        <label className="toggle-row" key={key}>
          <span>
            <span className="toggle-label">{label}</span>
            <span className="toggle-hint">{hint}</span>
          </span>
          <input type="checkbox" role="switch" checked={settings[key]} onChange={(e) => onChange({ ...settings, [key]: e.target.checked })} />
          <span className="switch" aria-hidden="true" />
        </label>
      ))}
    </div>
  )
}
