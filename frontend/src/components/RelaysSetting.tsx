import { useEffect, useState, type FormEvent } from 'react'
import { usePlaces } from '../placeStore'
import {
  loadNostrRelays,
  parseRelay,
  saveRelays,
  STEDE_RELAY,
  useRelays,
  withoutRelay,
  withRelay,
  withStede,
} from '../relayList'

// The relays your places are kept on (see relayList.ts): add and remove them,
// and leave out the stede relay once there's another. The relays of your NIP-65
// list are offered, each to tick.
export function RelaysSetting() {
  const { relays, nostrRelays } = useRelays()
  const { copying } = usePlaces()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const others = relays.filter((r) => r !== STEDE_RELAY)
  const stedeOn = relays.includes(STEDE_RELAY)
  // Relays added by hand; those of your NIP-65 list are listed with it.
  const added = others.filter((r) => !nostrRelays?.includes(r))
  useEffect(() => void loadNostrRelays(), [])

  const save = async (next: string[]) => {
    setBusy(true)
    setError(null)
    try {
      await saveRelays(next)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (e: FormEvent) => {
    e.preventDefault()
    let url: string
    try {
      url = parseRelay(address)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    if (relays.includes(url)) return setError('That relay is already in the list.')
    if (await save(withRelay(relays, url))) setAddress('')
  }

  const remove = (url: string) => {
    const back = others.length === 1 && !stedeOn ? ' The stede relay will be used again.' : ''
    if (!window.confirm(`Stop using ${host(url)}? Your places stay on it.${back}`)) return
    void save(withoutRelay(relays, url))
  }

  return (
    <div className="places-data relays">
      <h3>Relays</h3>
      <p className="key-note">
        Your places are kept, encrypted, on these relays. Each one you add gets a copy of them all.
      </p>
      <ul className="relay-list">
        <li>
          <label className="relay-check">
            <input
              type="checkbox"
              checked={stedeOn}
              disabled={busy || others.length === 0}
              onChange={(e) => void save(withStede(relays, e.target.checked))}
            />
            <span>
              Stede relay <span className="relay-host">{host(STEDE_RELAY)}</span>
            </span>
          </label>
        </li>
        {added.map((url) => (
          <li key={url}>
            <span className="relay-host">{host(url)}</span>
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => remove(url)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {nostrRelays && nostrRelays.length > 0 && (
        <>
          <p className="key-note">From your Nostr relay list (NIP-65):</p>
          <ul className="relay-list">
            {nostrRelays.map((url) => (
              <li key={url}>
                <label className="relay-check">
                  <input
                    type="checkbox"
                    checked={relays.includes(url)}
                    disabled={busy}
                    onChange={(e) =>
                      e.target.checked ? void save(withRelay(relays, url)) : remove(url)
                    }
                  />
                  <span className="relay-host">{host(url)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {others.length === 0 && (
        <p className="key-note">
          {nostrRelays?.length ? 'Tick or add' : 'Add'} another relay to be able to stop using the
          stede relay.
        </p>
      )}
      <form className="relay-add" onSubmit={(e) => void add(e)}>
        <input
          type="text"
          inputMode="url"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="wss://relay.example.com"
          aria-label="Relay address"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="submit" className="key-button" disabled={busy || !address.trim()}>
          Add
        </button>
      </form>
      {copying > 0 && (
        <p className="key-note" role="status">
          Copying to your relays… {copying.toLocaleString()} left
        </p>
      )}
      {error && <p className="key-error">{error}</p>}
    </div>
  )
}

// A relay's address without wss://, as it's shown.
function host(url: string): string {
  return url.replace(/^wss?:\/\//, '').replace(/\/$/, '')
}
