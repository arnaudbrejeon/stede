import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import type { WindowNostr } from 'nostr-tools/nip07'
import type { BunkerSigner } from 'nostr-tools/nip46'

// Your key as the app uses it: the NIP-07 API of Nostr browser extensions
// (window.nostr), with NIP-44 encryption. A key kept in this browser
// (keystore.ts), or in a remote signer, is wrapped in the same API, so the
// rest of the app works the same whichever holds the key.
export type Nostr = WindowNostr & { nip44: NonNullable<WindowNostr['nip44']> }

// A key kept in this browser, behind the extension API.
export function localNostr(secretKey: Uint8Array): Nostr {
  const pubkey = getPublicKey(secretKey)
  // Worked out once per correspondent (for your places: yourself).
  const keys = new Map<string, Uint8Array>()
  const keyFor = (peer: string) => {
    let key = keys.get(peer)
    if (!key) keys.set(peer, (key = nip44.v2.utils.getConversationKey(secretKey, peer)))
    return key
  }
  return {
    getPublicKey: async () => pubkey,
    signEvent: async (event) => finalizeEvent(event, secretKey),
    nip44: {
      encrypt: async (peer, plaintext) => nip44.v2.encrypt(plaintext, keyFor(peer)),
      decrypt: async (peer, payload) => nip44.v2.decrypt(payload, keyFor(peer)),
    },
  }
}

// The browser's extension, if it can encrypt with NIP-44 (places need it).
export function asNostr(extension: WindowNostr): Nostr {
  if (!extension.nip44) throw new Error('This extension can’t encrypt with NIP-44.')
  return extension as Nostr
}

// How long a remote signer may take to answer: long enough for its owner to
// approve a request on their phone.
const REMOTE_TIMEOUT_MS = 60_000

// A remote signer (NIP-46: Amber, nak bunker…), behind the extension API. Each
// call is a request over its relays, so one that's never answered (the phone
// asleep, the signer gone) fails after `timeoutMs` instead of waiting forever.
export function remoteNostr(signer: BunkerSigner, timeoutMs = REMOTE_TIMEOUT_MS): Nostr {
  const answer = <T>(request: Promise<T>) => signerAnswer(request, timeoutMs)
  return {
    getPublicKey: () => answer(signer.getPublicKey()),
    signEvent: (event) => answer(signer.signEvent(event)),
    nip44: {
      encrypt: (peer, plaintext) => answer(signer.nip44Encrypt(peer, plaintext)),
      decrypt: (peer, payload) => answer(signer.nip44Decrypt(peer, payload)),
    },
  }
}

// A remote signer's answer to `request`, or an error after `timeoutMs`. A
// signer's refusal comes as its bare reason ("unauthorized"): made an Error.
export function signerAnswer<T>(request: Promise<T>, timeoutMs = REMOTE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Your signer isn’t answering.')), timeoutMs)
    request
      .then(resolve, (error: unknown) =>
        reject(error instanceof Error ? error : new Error(`Your signer refused: ${error}`)),
      )
      .finally(() => clearTimeout(timer))
  })
}

// The NIP-07 extension, once it has injected itself into the page (some do so
// after the app starts); null if none shows up within `waitMs`.
export async function findExtension(waitMs = 1500): Promise<WindowNostr | null> {
  const started = Date.now()
  for (;;) {
    const nostr = (window as { nostr?: WindowNostr }).nostr
    if (nostr) return nostr
    if (Date.now() - started >= waitMs) return null
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export function hasExtension(): boolean {
  return typeof window !== 'undefined' && !!(window as { nostr?: WindowNostr }).nostr
}
