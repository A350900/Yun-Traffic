import type { LayerSettings } from '../state/layers'

interface Props {
  layers: LayerSettings
  onChange: (next: LayerSettings) => void
}

const OPTIONS: { key: keyof LayerSettings; label: string; hint: string }[] = [
  {
    key: 'dayNight',
    label: 'Day / night',
    hint: 'Night shading with civil, nautical and astronomical twilight. Updates every minute.',
  },
]

export default function LayersMenu({ layers, onChange }: Props) {
  return (
    <div className="popover" role="dialog" aria-label="Map layers">
      <h3>Map layers</h3>
      {OPTIONS.map((o) => (
        <label className="toggle-row" key={o.key}>
          <span>
            <span className="toggle-label">{o.label}</span>
            <span className="toggle-hint">{o.hint}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={layers[o.key]}
            onChange={(e) => onChange({ ...layers, [o.key]: e.target.checked })}
          />
          <span className="switch" aria-hidden="true" />
        </label>
      ))}
    </div>
  )
}
