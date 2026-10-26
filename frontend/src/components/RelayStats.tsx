import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchRelayStats,
  histogram,
  parseAuthors,
  PRIVATE_PLACE_KIND,
  type RelayStats as Stats,
} from '../relayStats'
import { RELAY_URL } from '../relayUrl'
import { Logo } from './Logo'

const AUTHORS = parseAuthors(__RELAY_AUTHORS_TXT__)
const RELAY_HOST = new URL(RELAY_URL).host

type State = { stats?: Stats; error?: string; counting: boolean }

// The relay's figures (stats.html, stede.cc/stats): how many private places it
// holds and how they spread over its authors, counted by the relay itself when
// the page opens. Public: the counts say nothing about the places, which are
// encrypted, and the pubkeys are on every event anyway.
export function RelayStats() {
  const [state, setState] = useState<State>({ counting: true })
  const run = useRef(0)

  // Only the latest count lands: a slow earlier one is ignored.
  const count = useCallback(() => {
    const current = ++run.current
    fetchRelayStats(RELAY_URL, AUTHORS).then(
      (stats) => current === run.current && setState({ stats, counting: false }),
      (error: unknown) =>
        current === run.current &&
        setState((s) => ({ ...s, error: errorMessage(error), counting: false })),
    )
  }, [])
  useEffect(count, [count])
  const countAgain = () => {
    setState((s) => ({ ...s, error: undefined, counting: true }))
    count()
  }

  const { stats, error, counting } = state
  const withPlaces = stats?.authors.filter((a) => a.count > 0).length ?? 0

  return (
    <main className="stats">
      <header className="stats-header">
        <a className="brand" href="/">
          <Logo />
          <span className="header-name">Stede</span>
        </a>
      </header>
      <h1>The relay</h1>
      <p className="stats-lead">
        What {RELAY_HOST} holds, counted by the relay itself when you opened this page.
      </p>
      {error && <p className="stats-error">The relay could not be counted: {error}.</p>}
      <section className="stats-figures" aria-busy={counting}>
        <div className="stat">
          <strong>{stats ? stats.events.toLocaleString() : '…'}</strong>
          <span>private places (kind {PRIVATE_PLACE_KIND} events)</span>
        </div>
        <div className="stat">
          <strong>{AUTHORS.length.toLocaleString()}</strong>
          <span>
            registered authors{stats && `, ${withPlaces.toLocaleString()} with places`}
          </span>
        </div>
      </section>
      <section className="stats-spread">
        <h2>Authors by number of places</h2>
        {stats ? <Histogram stats={stats} /> : <p className="stats-note">Counting…</p>}
      </section>
      <p className="stats-foot">
        {stats && (
          <>
            Counted at{' '}
            {stats.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.{' '}
            <button type="button" onClick={countAgain} disabled={counting}>
              Count again
            </button>
          </>
        )}
      </p>
      <p className="stats-note">
        The counts come from the relay's own index (NIP-45); the authors are the ones the relay
        accepts places from.
      </p>
    </main>
  )
}

// One row a bucket, the bar from the left for its share of the authors, the
// count beside it: the list is the table, the bars are a picture of it.
function Histogram({ stats }: { stats: Stats }) {
  const buckets = histogram(stats.authors)
  const most = Math.max(1, ...buckets.map((b) => b.authors))
  return (
    <ol className="histogram">
      {buckets.map((bucket) => (
        <li
          key={bucket.label}
          className={bucket.authors ? undefined : 'empty'}
          style={{ '--share': bucket.authors / most } as React.CSSProperties}
        >
          <span className="histogram-label">{bucket.label}</span>
          <span className="histogram-track">
            <span className="histogram-bar" />
          </span>
          <span className="histogram-value">{bucket.authors.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'the relay could not be reached'
}
