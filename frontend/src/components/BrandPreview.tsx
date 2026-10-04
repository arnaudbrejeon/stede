// Header brand colour candidates on the real header (dev-only /brand.html).
import { Logo } from './Logo'

type Candidate = { name: string; hex: string; note: string; ratio: string }

const CANDIDATES: Candidate[] = [
  { name: 'Iron-gall ink', hex: '#2b241d', ratio: '13.4', note: 'Today before the blue; sober' },
  { name: 'Sepia', hex: '#5a3e24', ratio: '8.5', note: 'Warm brown ink, close to the text' },
  { name: 'Oxblood', hex: '#6e1f1c', ratio: '9.8', note: 'Dark red; a deeper sibling of rubric' },
  { name: 'Burnt sienna', hex: '#864311', ratio: '6.5', note: 'Earthy orange-brown (tag pigment)' },
  { name: 'Bronze', hex: '#7a5520', ratio: '5.8', note: 'Darkened gold, readable' },
  { name: 'Old gold', hex: '#8a6a16', ratio: '4.4', note: 'Gilded feel, lowest contrast' },
  { name: 'Murex', hex: '#8f185f', ratio: '7.4', note: 'Royal purple-red (tag pigment)' },
  { name: 'Folium', hex: '#5e2a82', ratio: '8.6', note: 'Deep manuscript purple' },
  { name: 'Deep verdigris', hex: '#13574d', ratio: '7.3', note: 'Dark blue-green' },
  { name: 'Terre verte', hex: '#006b6e', ratio: '5.5', note: 'Teal earth (tag pigment)' },
  { name: 'Malachite deep', hex: '#1f5c38', ratio: '6.9', note: 'Forest green' },
  { name: 'Deep azurite', hex: '#1d3577', ratio: '10.0', note: 'The blue just tried' },
]

// Logo and title in different colours.
const PAIRS: { name: string; logo: string; title: string }[] = [
  { name: 'Old gold rider, ink title', logo: '#8a6a16', title: '#2b241d' },
  { name: 'Oxblood rider, ink title', logo: '#6e1f1c', title: '#2b241d' },
  { name: 'Ink rider, oxblood title', logo: '#2b241d', title: '#6e1f1c' },
]

export function BrandPreview() {
  return (
    <main className="brand-preview">
      <h1>Header brand colour</h1>
      <p className="intro">
        The real header on vellum, with the rubric “+” button alongside to judge the pairing.
        Contrast is against the vellum background.
      </p>
      {CANDIDATES.map((c) => (
        <Row key={c.hex} label={c.name} detail={`${c.hex} · ${c.ratio} : 1 · ${c.note}`} logo={c.hex} title={c.hex} />
      ))}
      <h2>Two-colour</h2>
      {PAIRS.map((p) => (
        <Row key={p.name} label={p.name} detail={`${p.logo} / ${p.title}`} logo={p.logo} title={p.title} />
      ))}
    </main>
  )
}

function Row({ label, detail, logo, title }: { label: string; detail: string; logo: string; title: string }) {
  return (
    <section className="row">
      <div className="row-label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <header className="b-header">
        <span className="b-brand">
          <span style={{ color: logo, display: 'flex' }}>
            <Logo />
          </span>
          <span className="b-name" style={{ color: title }}>
            Stede
          </span>
        </span>
        <q className="b-quote">Every kindly thing that is · Hath a kindly stede ther he</q>
        <span className="b-add" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18">
            <path d="M10 3.5v13M3.5 10h13" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </span>
      </header>
    </section>
  )
}
