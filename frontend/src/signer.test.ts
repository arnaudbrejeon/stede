import { generateSecretKey, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { asNostr, localNostr } from './signer'

describe('key kept in the browser, behind the extension API', () => {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const nostr = localNostr(sk)

  it('answers like an extension', async () => {
    expect(await nostr.getPublicKey()).toBe(pubkey)
    const event = await nostr.signEvent({ kind: 1, created_at: 1, tags: [], content: 'hi' })
    expect(verifyEvent(event)).toBe(true)
    expect(event.pubkey).toBe(pubkey)
  })

  it('encrypts with standard NIP-44, both ways', async () => {
    const key = nip44.v2.utils.getConversationKey(sk, pubkey)
    const sealed = await nostr.nip44.encrypt(pubkey, 'a place')
    expect(nip44.v2.decrypt(sealed, key)).toBe('a place')
    expect(await nostr.nip44.decrypt(pubkey, nip44.v2.encrypt('another', key))).toBe('another')
  })

  it('encrypts to someone else with their conversation key', async () => {
    const other = generateSecretKey()
    const sealed = await nostr.nip44.encrypt(getPublicKey(other), 'hello')
    const theirs = nip44.v2.utils.getConversationKey(other, pubkey)
    expect(nip44.v2.decrypt(sealed, theirs)).toBe('hello')
  })

  it('refuses an extension without NIP-44', () => {
    const extension = { getPublicKey: async () => pubkey, signEvent: nostr.signEvent }
    expect(() => asNostr(extension)).toThrow(/NIP-44/)
    expect(asNostr(nostr)).toBe(nostr)
  })
})
