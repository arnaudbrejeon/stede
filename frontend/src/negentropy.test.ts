import { afterEach, describe, expect, it, vi } from 'vitest'
import { reconcile, SyncUnavailable } from './negentropy'

type Item = { id: string; created_at: number }
const id = (n: number) => n.toString(16).padStart(64, '0')
const items = (from: number, to: number): Item[] =>
  Array.from({ length: to - from }, (_, i) => ({ id: id(from + i), created_at: 1000 + from + i }))

// Negentropy's variable-length integers: base 128, most significant first.
function varint(n: number): string {
  const digits = [n & 0x7f]
  for (n >>>= 7; n > 0; n >>>= 7) digits.unshift((n & 0x7f) | 0x80)
  return digits.map((d) => d.toString(16).padStart(2, '0')).join('')
}

// The relay's answer listing every id it holds, over the whole range: protocol
// version 0x61, an open upper bound (timestamp 0 = infinity, no id prefix), mode
// IdList (2), the count, then the ids. Empty means nothing left to say.
function idList(held: Item[]): string {
  if (held.length === 0) return '61'
  return (
    '61' + varint(0) + varint(0) + varint(2) + varint(held.length) + held.map((i) => i.id).join('')
  )
}

// A relay in memory: answers NIP-77 with the ids it holds, or as `behave` says.
function fakeRelay(held: Item[], behave: 'sync' | 'notice' | 'error' = 'sync') {
  const sent: unknown[][] = []
  class FakeSocket {
    onopen: (() => void) | null = null
    onmessage: ((message: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    constructor() {
      setTimeout(() => this.onopen?.())
    }
    send(text: string) {
      const message = JSON.parse(text)
      sent.push(message)
      const reply = (data: unknown[]) =>
        setTimeout(() => this.onmessage?.({ data: JSON.stringify(data) }))
      if (behave === 'notice') return reply(['NOTICE', 'ERROR: unknown cmd'])
      if (behave === 'error') return reply(['NEG-ERR', message[1], 'blocked: too many'])
      if (message[0] === 'NEG-OPEN') reply(['NEG-MSG', message[1], idList(held)])
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  return sent
}

afterEach(() => vi.unstubAllGlobals())

const filter = { kinds: [31301], authors: ['me'] }
const sorted = (ids: string[]) => [...ids].sort()

describe('reconcile', () => {
  it('finds what each side is missing', async () => {
    // Shared: 0–999. Here only: 1000–1009. Relay only: 2000–2049.
    fakeRelay([...items(0, 1000), ...items(2000, 2050)])
    const { have, need } = await reconcile('ws://relay', filter, [
      ...items(0, 1000),
      ...items(1000, 1010),
    ])
    expect(sorted(have)).toEqual(items(1000, 1010).map((i) => i.id))
    expect(sorted(need)).toEqual(items(2000, 2050).map((i) => i.id))
  })

  it('works from an empty browser', async () => {
    fakeRelay(items(0, 300))
    const { have, need } = await reconcile('ws://relay', filter, [])
    expect(have).toEqual([])
    expect(sorted(need)).toEqual(items(0, 300).map((i) => i.id))
  })

  it('ends when the relay has nothing to add', async () => {
    const sent = fakeRelay([])
    expect(await reconcile('ws://relay', filter, [])).toEqual({ have: [], need: [] })
    expect(sent.map((m) => m[0])).toEqual(['NEG-OPEN', 'NEG-CLOSE'])
    expect(sent[0].slice(2, 3)).toEqual([filter])
  })

  it.each(['notice', 'error'] as const)(
    'is unavailable when the relay answers with %s',
    async (behave) => {
      fakeRelay([], behave)
      await expect(reconcile('ws://relay', filter, [])).rejects.toThrow(SyncUnavailable)
    },
  )
})
