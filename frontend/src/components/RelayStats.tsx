import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRelayStats, PRIVATE_PLACE_KIND, type RelayStats as Stats } from '../relayStats'
import { RELAY_URL } from '../relayUrl'
import { Logo } from './Logo'

const RELAY_HOST = new URL(RELAY_URL).host

type State = { stats?: Stats; error?: string; counting: boolean }

// The relay's figures (stats.html, stede.cc/stats): how many private places it
// holds, counted by the relay itself when the page opens. Public: the count
// says nothing about the places, which are encrypted.
export function RelayStats() {
  const [state, setState] = useState<State>({ counting: true })
  const run = useRef(0)

  // Only the latest count lands: a slow earlier one is ignored.
  const count = useCallback(() => {
    const current = ++run.current
    fetchRelayStats(RELAY_URL).then(
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
      <p className="stats-note">The count comes from the relay's own index (NIP-45).</p>
    </main>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'the relay could not be reached'
}
