import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchBackupStatus,
  fetchRelayStats,
  PRIVATE_PLACE_KIND,
  type BackupStatus,
  type RelayStats as Stats,
} from '../relayStats'
import { RELAY_URL } from '../relayUrl'
import { Logo } from './Logo'

const RELAY_HOST = new URL(RELAY_URL).host
// Backups are nightly: one older than this means a night was missed.
const OVERDUE_MS = 26 * 3600 * 1000

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

  // undefined while asking, null when the backups can't be told.
  const [backups, setBackups] = useState<BackupStatus | null>()
  useEffect(() => {
    fetchBackupStatus().then(setBackups, () => setBackups(null))
  }, [])
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

      <h2>Backups</h2>
      <p className="stats-lead">
        Every night the relay's events are copied to Google Cloud Storage, and kept 30 days.
      </p>
      {backups === null && <p className="stats-error">The backups could not be checked.</p>}
      <BackupFigures backups={backups} />
    </main>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'the relay could not be reached'
}

function BackupFigures({ backups }: { backups: BackupStatus | null | undefined }) {
  if (backups === null) return null
  const latest = backups?.latest
  const overdue = !!backups && (!latest || backups.at.getTime() - latest.at.getTime() > OVERDUE_MS)
  return (
    <section className="stats-figures" aria-busy={backups === undefined}>
      <div className={overdue ? 'stat stat-warning' : 'stat'}>
        <strong>{backups ? (latest ? ago(latest.at, backups.at) : 'None yet') : '…'}</strong>
        <span>
          latest backup
          {latest && (
            <>
              , {when(latest.at)}, {megabytes(latest.bytes)}
            </>
          )}
          {overdue && latest && ' — a night was missed'}
        </span>
      </div>
      <div className="stat">
        <strong>{backups ? `in ${hours(backups.next.getTime() - backups.at.getTime())}` : '…'}</strong>
        <span>next backup{backups && <>, {when(backups.next)}</>}</span>
      </div>
      <div className="stat">
        <strong>{backups ? backups.kept : '…'}</strong>
        <span>backups kept</span>
      </div>
    </section>
  )
}

const when = (date: Date) =>
  date.toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const ago = (date: Date, now: Date) => `${hours(now.getTime() - date.getTime())} ago`

function hours(ms: number): string {
  const h = Math.round(ms / 3600_000)
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`
