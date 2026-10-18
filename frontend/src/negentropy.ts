import { nip77, type Filter } from 'nostr-tools'

// Set reconciliation with a relay (NIP-77, negentropy): given the events this
// browser holds, the relay and the browser exchange compact fingerprints of
// ranges of events, splitting only the ranges that differ, until each side
// knows which ids the other is missing. A visit with nothing changed costs a
// round trip or two, however many places there are.

// The relay doesn't do NIP-77, refused the sync, or couldn't be reached in time.
export class SyncUnavailable extends Error {}

export type Difference = {
  // Ids held here but not on the relay (replaced or deleted since).
  have: string[]
  // Ids on the relay but not held here (new, or new versions).
  need: string[]
}

const TIMEOUT_MS = 20_000

export function reconcile(
  url: string,
  filter: Filter,
  held: readonly { id: string; created_at: number }[],
): Promise<Difference> {
  const storage = new nip77.NegentropyStorageVector()
  for (const event of held) storage.insert(event.created_at, event.id)
  storage.seal()
  // Messages up to 60 kB, sent as 120 kB of hex: under strfry's 128 KiB limit.
  const negentropy = new nip77.Negentropy(storage)
  const subscription = `neg:${crypto.randomUUID().slice(0, 8)}`
  const difference: Difference = { have: [], need: [] }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      ws.close()
      if (error) reject(error)
      else resolve(difference)
    }
    const timer = setTimeout(
      () => finish(new SyncUnavailable('the relay took too long')),
      TIMEOUT_MS,
    )
    const send = (message: unknown[]) => ws.send(JSON.stringify(message))

    ws.onopen = () => send(['NEG-OPEN', subscription, filter, negentropy.initiate()])
    ws.onmessage = (message) => {
      let data: unknown[]
      try {
        data = JSON.parse(String(message.data))
      } catch {
        return
      }
      // Relays without NIP-77 answer an unknown message with a notice.
      if (data[0] === 'NOTICE') return finish(new SyncUnavailable(`relay notice: ${data[1]}`))
      if (data[1] !== subscription) return
      if (data[0] === 'NEG-ERR') return finish(new SyncUnavailable(`relay refused: ${data[2]}`))
      if (data[0] !== 'NEG-MSG') return
      try {
        const next = negentropy.reconcile(
          String(data[2]),
          (id) => difference.have.push(id),
          (id) => difference.need.push(id),
        )
        if (next) return send(['NEG-MSG', subscription, next])
        send(['NEG-CLOSE', subscription])
        finish()
      } catch (error) {
        finish(new SyncUnavailable(`bad sync message: ${error}`))
      }
    }
    ws.onerror = () => finish(new SyncUnavailable('could not reach the relay'))
    ws.onclose = () => finish(new SyncUnavailable('the relay closed the connection'))
  })
}
