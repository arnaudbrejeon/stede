import { beforeAll, describe, expect, it, vi } from 'vitest'

type RelayList = typeof import('./relayList')
let list: RelayList
let STEDE: string
const OTHER = 'wss://relay.example.com/'
const THIRD = 'wss://nos.example/'

beforeAll(async () => {
  vi.stubGlobal('location', { protocol: 'https:', host: 'stede.cc' })
  list = await import('./relayList')
  STEDE = list.STEDE_RELAY
})

describe('relay list', () => {
  it('is the stede relay at first', () => {
    expect(STEDE).toBe('wss://stede.cc/relay')
    expect(list.getRelays()).toEqual({ relays: [STEDE], createdAt: 0, nostrRelays: null })
  })

  it('reads relay addresses as typed', () => {
    expect(list.parseRelay(' relay.example.com ')).toBe(OTHER)
    expect(list.parseRelay('wss://Relay.Example.com:443/')).toBe(OTHER)
    expect(list.parseRelay('ws://localhost:7777')).toBe('ws://localhost:7777/')
    expect(() => list.parseRelay('ws://relay.example.com')).toThrow('wss://')
    expect(() => list.parseRelay('https://relay.example.com')).not.toThrow()
    expect(() => list.parseRelay('')).toThrow()
    expect(() => list.parseRelay('wss://not a host')).toThrow('isn’t a relay address')
  })

  it('reads the relays of a relay set, once each', () => {
    const tags = [
      ['d', 'stede'],
      ['relay', 'wss://relay.example.com'],
      ['relay', OTHER],
      ['relay', 'not a url ::'],
      ['r', THIRD],
      ['relay', THIRD],
    ]
    expect(list.relaysOf({ tags })).toEqual([OTHER, THIRD])
  })

  it('takes the relays you write to from a NIP-65 list', () => {
    const tags = [
      ['r', 'wss://relay.example.com'],
      ['r', 'wss://inbox.example/', 'read'],
      ['r', 'wss://nos.example', 'write'],
      ['r', 'ws://plain.example'],
      ['r', OTHER],
      ['p', 'f'.repeat(64)],
    ]
    expect(list.writeRelaysOf({ tags })).toEqual([OTHER, THIRD])
  })

  it('writes a relay set named stede', () => {
    expect(list.relaySetTemplate([STEDE, OTHER], 5)).toEqual({
      kind: 30002,
      created_at: 5,
      tags: [
        ['d', 'stede'],
        ['title', 'Stede places'],
        ['relay', STEDE],
        ['relay', OTHER],
      ],
      content: '',
    })
  })

  it('lets the stede relay go only once there is another', () => {
    expect(list.withStede([STEDE], false)).toEqual([STEDE])
    expect(list.withStede([STEDE, OTHER], false)).toEqual([OTHER])
    expect(list.withStede([OTHER], true)).toEqual([STEDE, OTHER])
    expect(list.withStede([STEDE, OTHER], true)).toEqual([STEDE, OTHER])
  })

  it('brings back the stede relay when the last other one goes', () => {
    expect(list.withoutRelay([OTHER], OTHER)).toEqual([STEDE])
    expect(list.withoutRelay([OTHER, THIRD], OTHER)).toEqual([THIRD])
    expect(list.withoutRelay([STEDE, OTHER], OTHER)).toEqual([STEDE])
  })

  it('adds a relay once', () => {
    expect(list.withRelay([STEDE], OTHER)).toEqual([STEDE, OTHER])
    expect(list.withRelay([STEDE, OTHER], OTHER)).toEqual([STEDE, OTHER])
  })
})
