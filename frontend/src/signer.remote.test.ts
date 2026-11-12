import { finalizeEvent, generateSecretKey, getPublicKey, nip44, verifyEvent } from 'nostr-tools'
import type { Event, Filter } from 'nostr-tools'
import { BunkerSigner } from 'nostr-tools/nip46'
import { describe, expect, it } from 'vitest'
import { remoteNostr, signerAnswer } from './signer'

const NOSTR_CONNECT = 24133

// A NIP-46 bunker holding `userKey`, and the relay between it and the app,
// both in memory. A client is answered once it connects with `secret`.
function fakeBunker(userKey: Uint8Array, secret: string, { silent = false } = {}) {
  const bunkerKey = generateSecretKey()
  const bunkerPubkey = getPublicKey(bunkerKey)
  const userPubkey = getPublicKey(userKey)
  const subs = new Set<{ filter: Filter; onevent: (event: Event) => void }>()
  const authorized = new Set<string>()
  const requests: string[] = []

  const answer = (method: string, params: string[], client: string): string => {
    if (method === 'connect') {
      if (params[1] !== secret) throw new Error('unauthorized')
      authorized.add(client)
      return 'ack'
    }
    if (!authorized.has(client)) throw new Error('unauthorized')
    const selfKey = (peer: string) => nip44.v2.utils.getConversationKey(userKey, peer)
    if (method === 'get_public_key') return userPubkey
    if (method === 'sign_event') return JSON.stringify(finalizeEvent(JSON.parse(params[0]), userKey))
    if (method === 'nip44_encrypt') return nip44.v2.encrypt(params[1], selfKey(params[0]))
    if (method === 'nip44_decrypt') return nip44.v2.decrypt(params[1], selfKey(params[0]))
    throw new Error(`unsupported: ${method}`)
  }

  const handle = (request: Event) => {
    const key = nip44.v2.utils.getConversationKey(bunkerKey, request.pubkey)
    const { id, method, params } = JSON.parse(nip44.v2.decrypt(request.content, key))
    requests.push(method)
    if (silent) return
    let reply: { id: string; result?: string; error?: string }
    try {
      reply = { id, result: answer(method, params, request.pubkey) }
    } catch (error) {
      reply = { id, error: (error as Error).message }
    }
    const event = finalizeEvent(
      {
        kind: NOSTR_CONNECT,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', request.pubkey]],
        content: nip44.v2.encrypt(JSON.stringify(reply), key),
      },
      bunkerKey,
    )
    for (const sub of subs) if (sub.filter['#p']?.includes(request.pubkey)) sub.onevent(event)
  }

  const pool = {
    subscribe(_relays: string[], filter: Filter, params: { onevent: (event: Event) => void }) {
      const sub = { filter, onevent: params.onevent }
      subs.add(sub)
      return { close: () => void subs.delete(sub) }
    },
    publish(_relays: string[], event: Event) {
      if (event.tags.some(([t, v]) => t === 'p' && v === bunkerPubkey))
        queueMicrotask(() => handle(event))
      return [Promise.resolve('ok')]
    },
  }
  const pointer = { pubkey: bunkerPubkey, relays: ['wss://bunker.test'], secret }
  return { pool, pointer, requests }
}

function pair(bunker: ReturnType<typeof fakeBunker>, secret = bunker.pointer.secret) {
  return BunkerSigner.fromBunker(
    generateSecretKey(),
    { ...bunker.pointer, secret },
    { pool: bunker.pool as never },
  )
}

describe('remote signer, behind the extension API', () => {
  const userKey = generateSecretKey()
  const pubkey = getPublicKey(userKey)

  it('answers like an extension once paired', async () => {
    const bunker = fakeBunker(userKey, 'secret')
    const signer = pair(bunker)
    await signerAnswer(signer.connect())
    const nostr = remoteNostr(signer)

    expect(await nostr.getPublicKey()).toBe(pubkey)
    const event = await nostr.signEvent({ kind: 1, created_at: 1, tags: [], content: 'hi' })
    expect(verifyEvent(event)).toBe(true)
    expect(event.pubkey).toBe(pubkey)

    // Standard NIP-44 to yourself, as places are: a key kept here reads it too.
    const key = nip44.v2.utils.getConversationKey(userKey, pubkey)
    const sealed = await nostr.nip44.encrypt(pubkey, 'a place')
    expect(nip44.v2.decrypt(sealed, key)).toBe('a place')
    expect(await nostr.nip44.decrypt(pubkey, nip44.v2.encrypt('another', key))).toBe('another')
    expect(bunker.requests).toEqual([
      'connect',
      'get_public_key',
      'sign_event',
      'nip44_encrypt',
      'nip44_decrypt',
    ])
  })

  it('reports a refusal as an error', async () => {
    const bunker = fakeBunker(userKey, 'secret')
    const signer = pair(bunker, 'wrong')
    await expect(signerAnswer(signer.connect())).rejects.toThrow(
      'Your signer refused: unauthorized',
    )
    await expect(remoteNostr(signer).getPublicKey()).rejects.toThrow(/unauthorized/)
  })

  it('gives up on a signer that never answers', async () => {
    const bunker = fakeBunker(userKey, 'secret', { silent: true })
    const nostr = remoteNostr(pair(bunker), 50)
    await expect(nostr.getPublicKey()).rejects.toThrow('Your signer isn’t answering.')
    expect(bunker.requests).toEqual(['get_public_key'])
  })
})
