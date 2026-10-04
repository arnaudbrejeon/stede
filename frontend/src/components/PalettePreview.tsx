// Review sheet for the proposed "Vellum & ink" palette (dev-only /palette.html).
import * as maplibregl from 'maplibre-gl'
import { useEffect, useRef, type CSSProperties } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BASE_STYLE_URL, flattenStyle, tintStyle, VELLUM_MAP_COLORS } from '../mapStyle'
import { PLACE_ICONS } from '../placeIcons'
import { Pin } from './IconPreview'
import { Logo } from './Logo'

// The tag palette before the pigment rework, kept here for comparison.
const TAG_PALETTE = [
  '#167ded', '#f8601a', '#25c58b', '#f2a613', '#fb4c9a', '#1eb11b', '#601df7',
  '#f82032', '#94560f', '#1fa7b3', '#d51dba', '#97ac1e', '#c93bfa', '#053894',
]

type Theme = {
  name: string
  bg: string
  map: string
  surface: string
  line: string
  ink: string
  muted: string
  accent: string
  link: string
  gold: string
}

const TODAY: Theme = {
  name: 'Today',
  bg: '#ffffff',
  map: '#f8f4f0',
  surface: '#ffffff',
  line: '#dde3ea',
  ink: '#1d2733',
  muted: '#5d6b7a',
  accent: '#1f6fb2',
  link: '#1f6fb2',
  gold: '#5d6b7a',
}

const VELLUM: Theme = {
  name: 'Vellum & ink',
  bg: '#f5efe3',
  map: '#efe7d6',
  surface: '#fbf8f1',
  line: '#e2d8c4',
  ink: '#2b241d',
  muted: '#6e6352',
  accent: '#9e3b2c',
  link: '#2f4a78',
  gold: '#9a7633',
}

// Proposed tag colours: the same 14 slots, rebased on medieval pigments, with
// light and dark pigments alternating so similar hues still differ in lightness.
const PIGMENTS: { name: string; hex: string }[] = [
  { name: 'Lapis ultramarine', hex: '#3547d2' },
  { name: 'Red lead', hex: '#f27626' },
  { name: 'Verdigris', hex: '#20af9b' },
  { name: 'Orpiment', hex: '#ebaf24' },
  { name: 'Madder rose', hex: '#f14988' },
  { name: 'Malachite', hex: '#1d8652' },
  { name: 'Folium purple', hex: '#7f26a9' },
  { name: 'Vermilion', hex: '#de251c' },
  { name: 'Burnt sienna', hex: '#884621' },
  { name: 'Terre verte', hex: '#0d5e61' },
  { name: 'Murex', hex: '#801b52' },
  { name: 'Sap green', hex: '#9e9b24' },
  { name: 'Woad lilac', hex: '#b896df' },
  { name: 'Azurite', hex: '#073285' },
]
const PIGMENT_HEXES = PIGMENTS.map((p) => p.hex)

// Sample pins around the Louvre for the live maps: [lng, lat, icon, tag slots].
const MAP_PINS: [number, number, keyof typeof PLACE_ICONS, number[]][] = [
  [2.3376, 48.8606, 'portico', [0, 10]],
  [2.3318, 48.8617, 'plate', [1]],
  [2.3428, 48.8619, 'goblet', [4, 3]],
  [2.3438, 48.8589, 'steaming-pot', [2, 12]],
  [2.3305, 48.8586, 'oak', [5, 11]],
  [2.3392, 48.8577, 'inn-sign', [6, 7, 8]],
  [2.3346, 48.8597, 'keep', [9, 13]],
]

// Third version: the pigments as they looked new, anchored on gold leaf
// (#e5b320, close to today's tag yellow) with the others raised to match.
const FRESH: Theme = {
  ...VELLUM,
  name: 'Fresh pigments',
  accent: '#b8321f',
  link: '#2b4fb8',
  gold: '#e5b320',
}

const FRESH_PIGMENTS: { name: string; hex: string }[] = [
  { name: 'Lapis ultramarine', hex: '#3351ed' },
  { name: 'Red lead', hex: '#f8701c' },
  { name: 'Verdigris', hex: '#19b7a1' },
  { name: 'Gold leaf', hex: '#e5b320' },
  { name: 'Madder rose', hex: '#f44488' },
  { name: 'Malachite', hex: '#189152' },
  { name: 'Folium purple', hex: '#8c25bb' },
  { name: 'Vermilion', hex: '#ea241c' },
  { name: 'Burnt sienna', hex: '#864311' },
  { name: 'Terre verte', hex: '#006b6e' },
  { name: 'Murex', hex: '#8f185f' },
  { name: 'Sap green', hex: '#889a19' },
  { name: 'Woad lilac', hex: '#ba8cec' },
  { name: 'Azurite', hex: '#053ca4' },
]
const FRESH_HEXES = FRESH_PIGMENTS.map((p) => p.hex)

const SWATCHES: { token: keyof Theme; label: string; role: string; text?: boolean }[] = [
  { token: 'bg', label: 'Vellum', role: 'Page and header background' },
  { token: 'surface', label: 'Surface', role: 'Panels, drawer, cards' },
  { token: 'line', label: 'Line', role: 'Borders and dividers' },
  { token: 'map', label: 'Map land', role: 'Base-map land tint' },
  { token: 'ink', label: 'Iron-gall ink', role: 'Text, icons, logo, primary button', text: true },
  { token: 'muted', label: 'Muted ink', role: 'Secondary text: addresses, counts', text: true },
  { token: 'accent', label: 'Rubric', role: 'The one accent: focus, selection', text: true },
  { token: 'link', label: 'Lapis', role: 'Links', text: true },
  { token: 'gold', label: 'Gold', role: 'Decoration only (quote marks, flourishes)', text: true },
]

export function PalettePreview() {
  return (
    <main className="palette-preview">
      <h1>Palette · Vellum &amp; ink</h1>
      <p className="intro">
        Drawn from the Ellesmere Chaucer manuscript: vellum, iron-gall ink, rubrication red, lapis
        and gold. Neutral by design so the tag colours stay the only vivid thing on the map.
      </p>

      <h2>Swatches</h2>
      <div className="swatches">
        {SWATCHES.map((s) => (
          <figure key={s.token} className="swatch-card">
            <div className="chip" style={{ background: VELLUM[s.token] }} />
            <figcaption>
              <strong>{s.label}</strong> <code>{VELLUM[s.token]}</code>
              <span>{s.role}</span>
              {s.text && (
                <span>
                  {contrast(VELLUM[s.token], VELLUM.bg).toFixed(1)} : 1 on vellum
                  {contrast(VELLUM[s.token], VELLUM.bg) < 4.5 ? ' (not for body text)' : ''}
                </span>
              )}
              {FRESH[s.token] !== VELLUM[s.token] && (
                <span className="fresh-alt">
                  <i style={{ background: FRESH[s.token] }} /> Fresh: <code>{FRESH[s.token]}</code>{' '}
                  {contrast(FRESH[s.token], FRESH.bg).toFixed(1)} : 1
                </span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>

      <h2>Interface</h2>
      <div className="side-by-side">
        <Mock theme={TODAY} tags={TAG_PALETTE} />
        <Mock theme={VELLUM} tags={PIGMENT_HEXES} />
        <Mock theme={FRESH} tags={FRESH_HEXES} />
      </div>

      <h2>Tag colours</h2>
      <p className="intro">
        Same 14 slots, rebased on medieval pigments. Light and dark pigments alternate so similar
        hues still differ in lightness. Closest pair for normal vision / worst for colour-blind
        viewers: today 8.9 / 0.9, pigments 12.8 / 2.9, fresh pigments 11.2 / 3.4.
      </p>
      <div className="tag-rows">
        <div className="tag-row">
          <span className="tag-row-label">Today</span>
          {TAG_PALETTE.map((hex) => (
            <span key={hex} className="tag-dot" style={{ background: hex }} title={hex} />
          ))}
        </div>
        <div className="tag-row">
          <span className="tag-row-label">Pigments</span>
          {PIGMENTS.map((p) => (
            <span key={p.hex} className="tag-dot" style={{ background: p.hex }} title={p.hex} />
          ))}
        </div>
        <div className="tag-row">
          <span className="tag-row-label">Fresh</span>
          {FRESH_PIGMENTS.map((p) => (
            <span key={p.hex} className="tag-dot" style={{ background: p.hex }} title={p.hex} />
          ))}
        </div>
      </div>
      <div className="pigment-list">
        {PIGMENTS.map((p, i) => (
          <span key={p.hex}>
            <i style={{ background: TAG_PALETTE[i] }} /> → <i style={{ background: p.hex }} /> /{' '}
            <i style={{ background: FRESH_HEXES[i] }} /> {FRESH_PIGMENTS[i].name}{' '}
            <code>{FRESH_HEXES[i]}</code>
          </span>
        ))}
      </div>

      <h2>Base map</h2>
      <p className="intro">
        Live maps, same view, with sample pins. Drag or zoom either one.
      </p>
      <div className="side-by-side maps">
        <LiveMap title="Today: base map and tag colours" tinted={false} tags={TAG_PALETTE} ink={TODAY.ink} />
        <LiveMap title="Vellum tint with pigment tags" tinted tags={PIGMENT_HEXES} ink={VELLUM.ink} />
        <LiveMap title="Vellum tint with fresh pigments" tinted tags={FRESH_HEXES} ink={FRESH.ink} />
      </div>
    </main>
  )
}

function Mock({ theme, tags }: { theme: Theme; tags: readonly string[] }) {
  const vars = {
    '--bg': theme.bg,
    '--map': theme.map,
    '--surface': theme.surface,
    '--line': theme.line,
    '--ink': theme.ink,
    '--muted': theme.muted,
    '--accent': theme.accent,
    '--link': theme.link,
    '--gold': theme.gold,
  } as CSSProperties
  return (
    <figure className="mock-wrap">
      <figcaption>{theme.name}</figcaption>
      <div className="mock" style={vars}>
        <header className="m-header">
          <span className="m-logo">
            <Logo size={26} />
          </span>
          <span className="m-name">Stede</span>
          <span className="m-quote">
            <span className="m-gold">“</span>Every kindly thing that is · Hath a kindly stede
            <span className="m-gold">”</span>
          </span>
        </header>
        <div className="m-body">
          <div className="m-panel">
            <div className="m-input m-focused">Filter by name</div>
            <div className="m-chips">
              <span className="m-chip m-selected">
                <i style={{ background: tags[0] }} />
                art
              </span>
              <span className="m-chip">
                <i style={{ background: tags[1] }} />
                bistro
              </span>
              <span className="m-chip">
                <i style={{ background: tags[4] }} />
                cocktails
              </span>
            </div>
            <p className="m-muted">10 of 10 places</p>
          </div>
          <div className="m-pins">
            <Pin icon={PLACE_ICONS.portico} colors={[tags[0], tags[10]]} ink={theme.ink} />
            <Pin icon={PLACE_ICONS.plate} colors={[tags[1]]} ink={theme.ink} />
            <Pin icon={PLACE_ICONS.goblet} colors={[tags[4], tags[3]]} ink={theme.ink} />
          </div>
          <button type="button" className="m-add">
            + Add a place
          </button>
          <aside className="m-drawer">
            <span className="m-link">← Back to results</span>
            <h3>Louvre</h3>
            <p className="m-muted">Museum · Place du Carrousel, Paris</p>
            <div className="m-chips">
              <span className="m-chip">
                <i style={{ background: tags[0] }} />
                art
              </span>
              <span className="m-chip">
                <i style={{ background: tags[10] }} />
                must-see
              </span>
            </div>
            <dl>
              <dt>Hours</dt>
              <dd>09:00–18:00</dd>
              <dt>Website</dt>
              <dd>
                <span className="m-link m-underline">louvre.fr</span>
              </dd>
            </dl>
          </aside>
        </div>
      </div>
    </figure>
  )
}

type LiveMapProps = { title: string; tinted: boolean; tags: readonly string[]; ink: string }

function LiveMap({ title, tinted, tags, ink }: LiveMapProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const map = new maplibregl.Map({ container: ref.current!, center: [2.3375, 48.86], zoom: 14.6 })
    map.setStyle(BASE_STYLE_URL, {
      transformStyle: (_previous, next) => {
        const flat = flattenStyle(next)
        return tinted ? tintStyle(flat, VELLUM_MAP_COLORS) : flat
      },
    })
    for (const [lng, lat, icon, slots] of MAP_PINS) {
      const element = document.createElement('div')
      element.innerHTML = renderToStaticMarkup(
        <Pin icon={PLACE_ICONS[icon]} colors={slots.map((i) => tags[i])} ink={ink} />,
      )
      new maplibregl.Marker({ element }).setLngLat([lng, lat]).addTo(map)
    }
    return () => map.remove()
  }, [tinted, tags, ink])
  return (
    <figure className="mock-wrap">
      <figcaption>{title}</figcaption>
      <div ref={ref} className="live-map" />
    </figure>
  )
}

// WCAG contrast ratio between two hex colours.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
