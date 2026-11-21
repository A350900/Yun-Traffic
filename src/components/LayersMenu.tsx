import type { LayerSettings } from '../state/layers'

interface Props {
  layers: LayerSettings
  onChange: (next: LayerSettings) => void
}

type ToggleKey = { [K in keyof LayerSettings]: LayerSettings[K] extends boolean ? K : never }[keyof LayerSettings]

const OPTIONS: { key: ToggleKey; label: string; hint: string }[] = [
  {
    key: 'dayNight',
    label: 'Day / night',
    hint: 'Night shading with civil, nautical and astronomical twilight. Updates every minute.',
  },
  {
    key: 'radar',
    label: 'Weather radar',
    hint: 'Rain and storms from the past 2 hours. More options under Weather.',
  },
  {
    key: 'airports',
    label: 'Airports',
    hint: "Pins for the world's 100 busiest airports. Click one for details.",
  },
  {
    key: 'countryAirlines',
    label: 'Airlines by country',
    hint: "Each country's main airlines (up to 3). Logos from Wikimedia Commons.",
  },
  {
    key: 'firBoundaries',
    label: 'Control boundaries',
    hint: 'En-route control areas (FIRs) worldwide; dashed over oceans. Approximate (VATSpy data, CC BY-SA).',
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
