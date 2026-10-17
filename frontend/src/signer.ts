import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import type { WindowNostr } from 'nostr-tools/nip07'

// Your key as the app uses it: the NIP-07 API of Nostr browser extensions
// (window.nostr), with NIP-44 encryption. A key kept in this browser
// (keystore.ts) is wrapped in the same API, so the rest of the app works the
// same whichever holds the key.
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
