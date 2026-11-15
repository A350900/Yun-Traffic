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
    </div>
  )
}
