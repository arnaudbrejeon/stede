// Review sheet for the place icon set at real pin size (dev-only /icons.html).
import { useId } from 'react'
import { ICON_CATEGORIES, PLACE_ICONS, type PlaceIcon } from '../placeIcons'
import { MARKER_RADIUS } from '../placeMarker'
import { TAG_PALETTE, UNTAGGED_COLOR } from '../tags'

const INK = '#2b241d'
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

// Ways of showing the tags' colours around the icon, to compare at real size.
//   ring      the app until 2026-10-24: a thin band, one equal arc per tag
//   wide      the same band, thicker, the icon a touch smaller
//   pie       the app today: wedges fill the disc, the icon on a white core
//   pie-ink   wedges fill the disc, the icon in ink straight on them
//   pie-white wedges fill the disc, the icon in white on them
export type PinDesign = 'ring' | 'wide' | 'pie' | 'pie-ink' | 'pie-white'
const PIN_DESIGNS: PinDesign[] = ['ring', 'wide', 'pie', 'pie-ink', 'pie-white']

type PinProps = { icon: PlaceIcon; colors: string[]; ink?: string; design?: PinDesign; scale?: number }

// Mirrors drawMarker for 'pie': white outline, tag-coloured wedges, icon on a white core.
export function Pin({ icon, colors, ink = INK, design = 'pie', scale = 1 }: PinProps) {
  const r = MARKER_RADIUS
  const n = colors.length
  const step = 360 / n
  const at = (deg: number, radius: number) => {
    const a = (deg * Math.PI) / 180
    return `${r + radius * Math.cos(a)} ${r + radius * Math.sin(a)}`
  }
  // An arc of the band between two angles (stroked), or a wedge to the centre (filled).
  const arc = (i: number, radius: number) =>
    `M${at(-90 + i * step, radius)}A${radius} ${radius} 0 ${step > 180 ? 1 : 0} 1 ${at(-90 + (i + 1) * step, radius)}`
  const wedge = (i: number, radius: number) => `M${r} ${r}L${arc(i, radius).slice(1)}Z`

  const band = design === 'wide' ? 8 : RING
  const bandR = r - OUTLINE - band / 2
  const inner = r - OUTLINE // the coloured disc, inside the white outline
  const core = 10.5 // white core holding the icon on 'pie'
  const iconSize = design === 'wide' ? 17 : design === 'pie' ? 15 : ICON_SIZE
  const glyphInk = design === 'pie-white' ? '#fff' : ink
  const s = iconSize / 24
  // The glyph through a mask, so its holes show whatever lies beneath (white
  // disc or wedge colour) rather than a fixed white.
  const maskId = useId()
  return (
    <svg width={r * 2 * scale} height={r * 2 * scale} viewBox={`0 0 ${r * 2} ${r * 2}`} aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          {icon.fill.map((d, i) => (
            <path key={i} d={d} fill="#fff" />
          ))}
          {icon.holes.map((d, i) => (
            <path key={`h${i}`} d={d} fill="#000" />
          ))}
        </mask>
      </defs>
      <circle cx={r} cy={r} r={r} fill="#fff" />
      {design === 'ring' || design === 'wide' ? (
        n === 1 ? (
          <circle cx={r} cy={r} r={bandR} fill="none" stroke={colors[0]} strokeWidth={band} />
        ) : (
          colors.map((c, i) => <path key={i} d={arc(i, bandR)} fill="none" stroke={c} strokeWidth={band} />)
        )
      ) : n === 1 ? (
        <circle cx={r} cy={r} r={inner} fill={colors[0]} />
      ) : (
        colors.map((c, i) => <path key={i} d={wedge(i, inner)} fill={c} />)
      )}
      {design === 'pie' && <circle cx={r} cy={r} r={core} fill="#fff" />}
      <g transform={`translate(${r - iconSize / 2} ${r - iconSize / 2}) scale(${s})`}>
        <rect width={24} height={24} fill={glyphInk} mask={`url(#${maskId})`} />
      </g>
    </svg>
  )
}

const SAMPLE_TAGS = [
  { label: 'untagged', colors: [UNTAGGED_COLOR] },
  { label: '1 tag', colors: [TAG_PALETTE[0]] },
  { label: '2 tags', colors: [TAG_PALETTE[1], TAG_PALETTE[5]] },
  { label: '3 tags', colors: [TAG_PALETTE[3], TAG_PALETTE[6], TAG_PALETTE[2]] },
  { label: '4 tags', colors: [TAG_PALETTE[7], TAG_PALETTE[0], TAG_PALETTE[11], TAG_PALETTE[4]] },
]
const SAMPLE_ICONS = ['plate', 'goblet', 'keep', 'portico'] as const

// Each design over the tag counts, at real size and three times it.
function MarkerDesigns() {
  return (
    <section className="designs">
      <h2>Marker designs</h2>
      {PIN_DESIGNS.map((design) => (
        <figure key={design}>
          <figcaption>{design}</figcaption>
          <div className="map-bg">
            {SAMPLE_TAGS.map((t, ti) => (
              <Pin key={t.label} icon={PLACE_ICONS[SAMPLE_ICONS[ti % SAMPLE_ICONS.length]]} colors={t.colors} design={design} />
            ))}
          </div>
          <div className="map-bg">
            {SAMPLE_TAGS.map((t, ti) => (
              <Pin key={t.label} icon={PLACE_ICONS[SAMPLE_ICONS[ti % SAMPLE_ICONS.length]]} colors={t.colors} design={design} scale={3} />
            ))}
          </div>
        </figure>
      ))}
    </section>
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
      <MarkerDesigns />
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
