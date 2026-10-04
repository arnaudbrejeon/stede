// Review sheet for the place icon set at real pin size (dev-only /icons.html).
import { ICON_CATEGORIES, PLACE_ICONS, type PlaceIcon } from '../placeIcons'
import { MARKER_RADIUS } from '../placeMarker'
import { TAG_PALETTE } from '../tags'

const INK = '#1d2733'
const OUTLINE = 4.5
const RING = 5.25
const ICON_SIZE = 19.5

function Glyph({ icon, size }: { icon: PlaceIcon; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {icon.fill.map((d, i) => (
        <path key={i} d={d} fill={INK} />
      ))}
      {icon.holes.map((d, i) => (
        <path key={`h${i}`} d={d} fill="#fff" />
      ))}
    </svg>
  )
}

// Mirrors drawMarker: white disc, tag-coloured ring, icon in the middle.
function Pin({ icon, colors }: { icon: PlaceIcon; colors: string[] }) {
  const r = MARKER_RADIUS
  const ringR = r - OUTLINE - RING / 2
  const step = 360 / colors.length
  const arc = (i: number) => {
    const a0 = ((-90 + i * step) * Math.PI) / 180
    const a1 = ((-90 + (i + 1) * step) * Math.PI) / 180
    const large = step > 180 ? 1 : 0
    return `M${r + ringR * Math.cos(a0)} ${r + ringR * Math.sin(a0)}A${ringR} ${ringR} 0 ${large} 1 ${r + ringR * Math.cos(a1)} ${r + ringR * Math.sin(a1)}`
  }
  const s = ICON_SIZE / 24
  return (
    <svg width={r * 2} height={r * 2} aria-hidden="true">
      <circle cx={r} cy={r} r={r} fill="#fff" />
      {colors.length === 1 ? (
        <circle cx={r} cy={r} r={ringR} fill="none" stroke={colors[0]} strokeWidth={RING} />
      ) : (
        colors.map((c, i) => <path key={i} d={arc(i)} fill="none" stroke={c} strokeWidth={RING} />)
      )}
      <g transform={`translate(${r - ICON_SIZE / 2} ${r - ICON_SIZE / 2}) scale(${s})`}>
        {icon.fill.map((d, i) => (
          <path key={i} d={d} fill={INK} />
        ))}
        {icon.holes.map((d, i) => (
          <path key={`h${i}`} d={d} fill="#fff" />
        ))}
      </g>
    </svg>
  )
}

export function IconPreview() {
  return (
    <main className="icon-preview">
      <h1>Place icons</h1>
      <p>
        Default and alternatives per category. Pins are shown at real size on a map-like
        background.
      </p>
      {ICON_CATEGORIES.map((category, ci) => (
        <section key={category.key}>
          <h2>
            {ci + 1}. {category.label}
          </h2>
          <div className="variants">
            {category.icons
              .map((key) => [key, PLACE_ICONS[key] as PlaceIcon] as const)
              .map(([key, ic], vi) => (
                <figure key={key}>
                  <figcaption>
                    {vi === 0 ? 'Default' : 'Alternative'} · {ic.label}
                  </figcaption>
                  <div className="samples">
                    <Glyph icon={ic} size={72} />
                    <Glyph icon={ic} size={24} />
                    <div className="map-bg">
                      <Pin icon={ic} colors={[TAG_PALETTE[ci % TAG_PALETTE.length]]} />
                      <Pin
                        icon={ic}
                        colors={[TAG_PALETTE[(ci + 3) % 14], TAG_PALETTE[(ci + 7) % 14]]}
                      />
                    </div>
                  </div>
                </figure>
              ))}
          </div>
        </section>
      ))}
    </main>
  )
}
