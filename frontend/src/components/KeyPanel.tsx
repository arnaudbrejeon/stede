import { useState, type FormEvent } from 'react'
import * as nip19 from 'nostr-tools/nip19'
import { PlacesData } from './PlacesData'
import {
  checkPassword,
  connectExtension,
  disconnectExtension,
  forgetKey,
  importKey,
  lock,
  unlock,
  useKey,
} from '../keystore'
import { hasExtension } from '../signer'

// Adding, unlocking and locking the user's Nostr key (see keystore.ts).
type KeyPanelProps = {
  // Opened from '+': say why the key is needed.
  forAdding?: boolean
}

export function KeyPanel({ forAdding }: KeyPanelProps) {
  const { status, pubkey, kind } = useKey()
  return (
    <div className="key-panel">
      <h2>Your Nostr key</h2>
      {forAdding && status !== 'unlocked' && status !== 'loading' && (
        <p className="key-note">
          Your places are saved with your Nostr key. Add it or unlock it to add a place.
        </p>
      )}
      {status === 'loading' && <p className="key-note">Checking this browser…</p>}
      {status === 'none' && (
        <>
          <UseExtension />
          <AddKey />
        </>
      )}
      {status === 'locked' && pubkey && kind === 'extension' && (
        <ExtensionMissing pubkey={pubkey} />
      )}
      {status === 'locked' && pubkey && kind === 'local' && <Unlock pubkey={pubkey} />}
      {status === 'unlocked' && pubkey && kind === 'extension' && (
        <ExtensionConnected pubkey={pubkey} />
      )}
      {status === 'unlocked' && pubkey && kind === 'local' && <Unlocked pubkey={pubkey} />}
    </div>
  )
}

function AddKey() {
  const [nsec, setNsec] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      checkPassword(password)
      if (password !== confirm) throw new Error('The passwords don’t match.')
      await importKey(nsec, password)
    })
  }

  return (
    <form className="key-form" onSubmit={submit}>
      <p className="key-note">
        Paste your secret key and choose a password. Stede keeps the key in this browser, encrypted
        with the password, and never sends it anywhere.
      </p>
      <label>
        Secret key
        <input
          type="password"
          value={nsec}
          onChange={(e) => setNsec(e.target.value)}
          placeholder="nsec1…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <label>
        Password again
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      {error && <p className="key-error">{error}</p>}
      <button type="submit" className="key-button" disabled={busy}>
        {busy ? 'Encrypting…' : 'Add key'}
      </button>
      <p className="key-note">
        Browsers can clear what a site keeps (Safari does after a week of not visiting it), so keep
        your nsec somewhere safe: you’ll need it to add the key again.
      </p>
    </form>
  )
}

function Unlock({ pubkey }: { pubkey: string }) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(() => unlock(password))
  }

  return (
    <form className="key-form" onSubmit={submit}>
      <Npub pubkey={pubkey} />
      <p className="key-note">Locked. Enter your password to unlock it for this browser session.</p>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          required
        />
      </label>
      {error && <p className="key-error">{error}</p>}
      <button type="submit" className="key-button" disabled={busy}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <ForgetButton />
    </form>
  )
}

function Unlocked({ pubkey }: { pubkey: string }) {
  return (
    <div className="key-form">
      <Npub pubkey={pubkey} />
      <p className="key-note">Unlocked until you close the browser or lock it.</p>
      <button type="button" className="key-button" onClick={() => void lock()}>
        Lock
      </button>
      <ForgetButton />
      <PlacesData />
    </div>
  )
}

// A NIP-07 extension (nos2x, Alby…) keeps the key; stede asks it to sign and
// encrypt. Offered first when the browser has one.
function UseExtension() {
  const { busy, error, run } = useAction()
  const available = hasExtension()
  return (
    <div className="key-form key-extension">
      <p className="key-note">
        {available
          ? 'A Nostr extension is installed in this browser: stede can use your key there, without ever seeing it.'
          : 'With a Nostr extension (nos2x, Alby…), stede can use your key without ever seeing it.'}
      </p>
      <button
        type="button"
        className="key-button"
        disabled={busy || !available}
        onClick={() => run(connectExtension)}
      >
        {busy ? 'Waiting for the extension…' : 'Use my Nostr extension'}
      </button>
      {error && <p className="key-error">{error}</p>}
      <p className="key-divider">or keep your key in this browser</p>
    </div>
  )
}

function ExtensionConnected({ pubkey }: { pubkey: string }) {
  return (
    <div className="key-form">
      <Npub pubkey={pubkey} />
      <p className="key-note">
        Using your Nostr extension. Loading many places can take a while: it decrypts them one by
        one, and may ask you first.
      </p>
      <button type="button" className="link-button" onClick={disconnectExtension}>
        Stop using the extension
      </button>
      <PlacesData />
    </div>
  )
}

function ExtensionMissing({ pubkey }: { pubkey: string }) {
  const { busy, error, run } = useAction()
  return (
    <div className="key-form">
      <Npub pubkey={pubkey} />
      <p className="key-note">
        Your Nostr extension isn’t answering. Is it installed and unlocked?
      </p>
      <button
        type="button"
        className="key-button"
        disabled={busy}
        onClick={() => run(connectExtension)}
      >
        {busy ? 'Waiting for the extension…' : 'Connect again'}
      </button>
      {error && <p className="key-error">{error}</p>}
      <button type="button" className="link-button" onClick={disconnectExtension}>
        Stop using the extension
      </button>
    </div>
  )
}

function ForgetButton() {
  const forget = () => {
    if (window.confirm('Remove your key from this browser? You’ll need your nsec to add it again.'))
      void forgetKey()
  }
  return (
    <button type="button" className="link-button" onClick={forget}>
      Remove key from this browser
    </button>
  )
}

function Npub({ pubkey }: { pubkey: string }) {
  const npub = nip19.npubEncode(pubkey)
  return (
    <p className="key-npub" title={npub}>
      {npub.slice(0, 12)}…{npub.slice(-6)}
    </p>
  )
}

// Runs an async action, keeping its busy flag and error message.
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    // Let the busy label paint before scrypt blocks the main thread.
    setTimeout(() => {
      action()
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false))
    }, 20)
  }
  return { busy, error, run }
}
