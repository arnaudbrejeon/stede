import { useState, type FormEvent } from 'react'
import { getPublicKey } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { PlacesData } from './PlacesData'
import {
  addPasskey,
  addPassword,
  checkPassword,
  connectExtension,
  disconnectExtension,
  forgetKey,
  importKey,
  importKeyWithPasskey,
  lock,
  parseSecretKey,
  removePasskey,
  unlock,
  unlockWithPasskey,
  useKey,
} from '../keystore'
import { passkeysAvailable } from '../passkey'
import { hasExtension } from '../signer'

// Adding, unlocking and locking the user's Nostr key (see keystore.ts).
type KeyPanelProps = {
  // Opened from '+': say why the key is needed.
  forAdding?: boolean
}

export function KeyPanel({ forAdding }: KeyPanelProps) {
  const { status, pubkey, kind, passkey, password } = useKey()
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
      {status === 'locked' && pubkey && kind === 'local' && (
        <Unlock pubkey={pubkey} passkey={passkey} password={password} />
      )}
      {status === 'unlocked' && pubkey && kind === 'extension' && (
        <ExtensionConnected pubkey={pubkey} />
      )}
      {status === 'unlocked' && pubkey && kind === 'local' && (
        <Unlocked pubkey={pubkey} passkey={passkey} password={password} />
      )}
    </div>
  )
}

// The key is added unlocked by Face ID or a fingerprint where the browser can
// make passkeys, or by a password, which is also the way when it can't.
function AddKey() {
  const [nsec, setNsec] = useState('')
  const canUsePasskey = passkeysAvailable()
  const [withPassword, setWithPassword] = useState(!canUsePasskey)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (withPassword)
      run(async () => {
        checkPassword(password)
        if (password !== confirm) throw new Error('The passwords don’t match.')
        await importKey(nsec, password)
      })
    else
      run(
        async () => {
          parseSecretKey(nsec)
          try {
            await importKeyWithPasskey(nsec)
          } catch (error) {
            // No passkey: a password will do.
            setWithPassword(true)
            throw error
          }
        },
        { now: true },
      )
  }

  return (
    <form className="key-form" onSubmit={submit}>
      <p className="key-note">
        {withPassword
          ? 'Paste your secret key and choose a password. Stede keeps the key in this browser, encrypted with the password, and never sends it anywhere.'
          : 'Paste your secret key. Stede keeps it in this browser, encrypted, unlocked by Face ID or your fingerprint, and never sends it anywhere.'}
      </p>
      <label>
        Secret key
        {/* Masked, but not a password to save: password managers are told to leave it. */}
        <input
          type="password"
          value={nsec}
          onChange={(e) => setNsec(e.target.value)}
          placeholder="nsec1…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-bwignore
          data-1p-ignore
          data-lpignore="true"
          required
        />
      </label>
      {withPassword && (
        <>
          <Username npub={npubOf(nsec)} />
          <NewPassword
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
          />
        </>
      )}
      {error && <p className="key-error">{error}</p>}
      <button type="submit" className="key-button" disabled={busy}>
        {withPassword
          ? busy
            ? 'Encrypting…'
            : 'Add key'
          : busy
            ? 'Waiting for your device…'
            : 'Add with Face ID or fingerprint'}
      </button>
      {canUsePasskey && (
        <button
          type="button"
          className="link-button"
          onClick={() => setWithPassword(!withPassword)}
        >
          {withPassword ? 'Use Face ID or fingerprint instead' : 'Use a password instead'}
        </button>
      )}
      <p className="key-note">
        Browsers can clear what a site keeps (Safari does after a week of not visiting it), so keep
        your nsec somewhere safe: you’ll need it to add the key again.
      </p>
    </form>
  )
}

function NewPassword(props: {
  password: string
  confirm: string
  onPassword: (password: string) => void
  onConfirm: (password: string) => void
}) {
  return (
    <>
      <label>
        Password
        <input
          type="password"
          value={props.password}
          onChange={(e) => props.onPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <label>
        Password again
        <input
          type="password"
          value={props.confirm}
          onChange={(e) => props.onConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
    </>
  )
}

type UnlockProps = { pubkey: string; passkey: boolean; password: boolean }

function Unlock({ pubkey, passkey, password }: UnlockProps) {
  return (
    <>
      {passkey && <PasskeyUnlock pubkey={pubkey} password={password} />}
      {password && <PasswordUnlock pubkey={pubkey} passkey={passkey} />}
    </>
  )
}

function PasskeyUnlock({ pubkey, password }: { pubkey: string; password: boolean }) {
  const { busy, error, run } = useAction()
  return (
    <div className="key-form">
      <Npub pubkey={pubkey} />
      <p className="key-note">Locked.</p>
      <button
        type="button"
        className="key-button"
        disabled={busy}
        onClick={() => run(unlockWithPasskey, { now: true })}
      >
        {busy ? 'Waiting for your device…' : 'Unlock with Face ID or fingerprint'}
      </button>
      {error && <p className="key-error">{error}</p>}
      {password ? <p className="key-divider">or use your password</p> : <ForgetButton />}
    </div>
  )
}

// With a passkey, the password is the fallback: it doesn't grab the focus, or
// a phone would open its keyboard over the Face ID prompt.
function PasswordUnlock({ pubkey, passkey }: { pubkey: string; passkey: boolean }) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(() => unlock(password))
  }

  return (
    <form className="key-form" onSubmit={submit}>
      <Username npub={nip19.npubEncode(pubkey)} />
      {!passkey && (
        <>
          <Npub pubkey={pubkey} />
          <p className="key-note">
            Locked. Enter your password to unlock it for this browser session.
          </p>
        </>
      )}
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus={!passkey}
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

function Unlocked({ pubkey, passkey, password }: UnlockProps) {
  return (
    <div className="key-form">
      <Npub pubkey={pubkey} />
      <p className="key-note">Unlocked until you close the browser or lock it.</p>
      <button type="button" className="key-button" onClick={() => void lock()}>
        Lock
      </button>
      <PasskeySetting pubkey={pubkey} passkey={passkey} password={password} />
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

// Unlocking with a passkey instead of the password, offered where the browser
// can make one. Phones end the browser session whenever they close the app,
// so there it spares typing the password each time. Without a password, the
// passkey stays until there is one, or nothing would unlock the key.
function PasskeySetting({ pubkey, passkey, password }: UnlockProps) {
  const { busy, error, run } = useAction()

  if (passkey && password)
    return (
      <div className="key-passkey">
        <p className="key-note">
          Face ID, Touch ID or your fingerprint unlocks your key here; your password works too.
        </p>
        <button type="button" className="link-button" onClick={() => run(async () => removePasskey())}>
          Stop unlocking with Face ID or fingerprint
        </button>
        {error && <p className="key-error">{error}</p>}
      </div>
    )
  if (passkey)
    return (
      <div className="key-passkey">
        <p className="key-note">Face ID, Touch ID or your fingerprint unlocks your key here.</p>
        <AddPassword pubkey={pubkey} />
      </div>
    )
  if (!passkeysAvailable()) return null
  return (
    <div className="key-passkey">
      <button
        type="button"
        className="key-button"
        disabled={busy}
        onClick={() => run(addPasskey, { now: true })}
      >
        {busy ? 'Waiting for your device…' : 'Use Face ID or fingerprint to unlock'}
      </button>
      <p className="key-note">
        Makes a passkey in your password manager, so you don’t type your password each time.
      </p>
      {error && <p className="key-error">{error}</p>}
    </div>
  )
}

// A password as a backup for the passkey, should it be lost.
function AddPassword({ pubkey }: { pubkey: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, run } = useAction()

  if (!open)
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        Add a password as a backup
      </button>
    )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(async () => {
      if (password !== confirm) throw new Error('The passwords don’t match.')
      await addPassword(password)
    })
  }

  return (
    <form className="key-form" onSubmit={submit}>
      <Username npub={nip19.npubEncode(pubkey)} />
      <NewPassword
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
      />
      {error && <p className="key-error">{error}</p>}
      <button type="submit" className="key-button" disabled={busy}>
        {busy ? 'Encrypting…' : 'Add password'}
      </button>
    </form>
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

// Password managers save and fill a username with each password, and on iOS
// often offer nothing for a password field alone. The npub is the username.
function Username({ npub }: { npub: string }) {
  return (
    <input
      type="text"
      name="username"
      className="key-username"
      value={npub}
      autoComplete="username"
      readOnly
      tabIndex={-1}
      aria-hidden="true"
    />
  )
}

function npubOf(nsec: string): string {
  try {
    return nip19.npubEncode(getPublicKey(parseSecretKey(nsec)))
  } catch {
    return ''
  }
}

function Npub({ pubkey }: { pubkey: string }) {
  const npub = nip19.npubEncode(pubkey)
  return (
    <p className="key-npub" title={npub}>
      {npub.slice(0, 12)}…{npub.slice(-6)}
    </p>
  )
}

// Runs an async action, keeping its busy flag and error message. `now` runs it
// within the tap: Safari only shows a passkey prompt asked for by a tap.
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = (action: () => Promise<void>, { now = false } = {}) => {
    setBusy(true)
    setError(null)
    const start = () =>
      action()
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false))
    if (now) start()
    // Let the busy label paint before scrypt blocks the main thread.
    else setTimeout(start, 20)
  }
  return { busy, error, run }
}
