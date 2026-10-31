import * as nip19 from 'nostr-tools/nip19'

// Unlocking the key kept in this browser (keystore.ts) with Face ID, Touch ID,
// a fingerprint or the device's screen lock, instead of typing the password.
//
// A passkey with the WebAuthn PRF extension gives back the same 32-byte secret
// each time it's used with the same salt, and only once the device has checked
// it's you. That secret, through HKDF, is an AES key that wraps the user's key a
// second time, next to the password's ncryptsec, which stays as the fallback.
// No server is involved: the challenge is random and the signature is never
// checked; only the secret matters, and nothing but the device can produce it.
//
// The passkey lives in the device's password manager (iCloud Keychain, Google
// Password Manager…), bound to this site's domain. Not every manager supports
// PRF, so support is only known for sure once a passkey has been made.

// What localStorage keeps: which passkey, the salt it's used with, and the key
// it wraps, as base64(12-byte IV + AES-GCM ciphertext).
export type PasskeyRecord = {
  credentialId: string // base64url, as WebAuthn writes credential ids
  transports?: string[]
  salt: string // base64
  wrapped: string
}

export type NewPasskey = Omit<PasskeyRecord, 'wrapped'> & { wrappingKey: CryptoKey }

const HKDF_INFO = 'stede passkey unlock'

// Keep the passkey on this phone or computer, rather than offering a QR code
// for another device or a security key. Newer than TypeScript's DOM types.
type Hinted<T> = T & { hints?: ('client-device' | 'hybrid' | 'security-key')[] }

// Off for now: not offered when adding a key or once it's unlocked. Bitwarden
// can't return PRF results yet (its passkeys can't unlock the key), and a
// password it fills does nearly as well. A passkey already set up still unlocks.
const OFFER_PASSKEYS = false

// Whether to offer passkeys: the browser can make them (in a secure context).
// Whether its password manager supports PRF is only known by making one:
// getClientCapabilities() can't be trusted to say, so it isn't asked.
export function passkeysAvailable(): boolean {
  return (
    OFFER_PASSKEYS &&
    typeof PublicKeyCredential !== 'undefined' &&
    !!navigator.credentials?.create
  )
}

// Makes a passkey for this key and works out the AES key it unlocks. Making a
// passkey for the same pubkey again replaces the old one in the password manager.
export async function createPasskey(pubkey: string): Promise<NewPasskey> {
  const npub = nip19.npubEncode(pubkey)
  const name = `${npub.slice(0, 12)}…${npub.slice(-6)}`
  const salt = randomBytes(32)
  const credential = (await callWebAuthn(() =>
    navigator.credentials.create({
      publicKey: {
        rp: { name: 'Stede' },
        user: { id: hexToBytes(pubkey), name, displayName: name },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256, for some Windows Hello setups
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        hints: ['client-device'],
        extensions: { prf: { eval: { first: salt } } },
      } satisfies Hinted<PublicKeyCredentialCreationOptions> as PublicKeyCredentialCreationOptions,
    }),
  )) as PublicKeyCredential | null
  if (!credential) throw new Error('No passkey was made.')

  const record = {
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    transports: (credential.response as AuthenticatorAttestationResponse).getTransports?.(),
    salt: toBase64(salt),
  }
  const prf = credential.getClientExtensionResults().prf
  // Safari often returns the secret right away; Chrome on Android usually only
  // says PRF is enabled, and the secret takes a second Face ID / fingerprint.
  let secret = prf?.results?.first ? toBytes(prf.results.first) : null
  if (!secret && prf?.enabled !== false) {
    try {
      secret = await prfSecret(record)
    } catch (error) {
      if (!(error instanceof NoPrfError)) throw error
    }
  }
  if (!secret) {
    forgetPasskey(record.credentialId)
    throw new NoPrfError()
  }
  return { ...record, wrappingKey: await wrappingKey(secret) }
}

// Asks the passkey for the AES key that unwraps the stored key: Face ID, Touch
// ID, fingerprint or screen lock, as the device chooses.
export async function unlockingKey(record: PasskeyRecord): Promise<CryptoKey> {
  return wrappingKey(await prfSecret(record))
}

// Tells the password manager the passkey isn't used anymore, so it can offer to
// delete it. Few support this yet; it's only a hint, and errors don't matter.
export function forgetPasskey(credentialId: string): void {
  const rpId = globalThis.location?.hostname
  if (!rpId || typeof PublicKeyCredential === 'undefined') return
  PublicKeyCredential.signalUnknownCredential?.({ rpId, credentialId })?.catch(() => {})
}

class NoPrfError extends Error {
  constructor() {
    super(
      'Your password manager can’t unlock Stede with a passkey. Try another one (iCloud Keychain, Google Password Manager), or keep using your password.',
    )
  }
}

async function prfSecret(record: Omit<PasskeyRecord, 'wrapped'>): Promise<Uint8Array> {
  const assertion = (await callWebAuthn(() =>
    navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [
          {
            type: 'public-key',
            id: fromBase64Url(record.credentialId),
            transports: record.transports as AuthenticatorTransport[] | undefined,
          },
        ],
        userVerification: 'required',
        hints: ['client-device'],
        extensions: { prf: { eval: { first: fromBase64(record.salt) } } },
      } satisfies Hinted<PublicKeyCredentialRequestOptions> as PublicKeyCredentialRequestOptions,
    }),
  )) as PublicKeyCredential | null
  const first = assertion?.getClientExtensionResults().prf?.results?.first
  if (!first) throw new NoPrfError()
  return toBytes(first)
}

async function wrappingKey(secret: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// WebAuthn's errors, in words. NotAllowedError covers both "cancelled" and
// "timed out", and also a prompt the browser refused to show without a tap.
async function callWebAuthn<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError')
      throw new Error('Cancelled, or your device couldn’t check it’s you.', { cause: error })
    if (error instanceof Error && error.name === 'SecurityError')
      throw new Error('Passkeys don’t work on this address.', { cause: error })
    throw error
  }
}

function toBytes(value: BufferSource): Uint8Array {
  return ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value)
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  return fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'))
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16))
}
