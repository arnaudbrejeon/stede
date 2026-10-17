import { describe, expect, it } from 'vitest'
import { innerPlace, placeFromInner } from './placeEvents'
import { NO_PLACES } from './places'
import { WELCOME_PLACE, withWelcome } from './welcomePlace'

describe('welcome place', () => {
  it('shows on an empty map only', () => {
    expect(withWelcome(NO_PLACES, false).features).toEqual([WELCOME_PLACE])
    const yours = placeFromInner(innerPlace({ id: 'a', name: 'Mine', lngLat: [2, 48] }))!
    const places = { type: 'FeatureCollection' as const, features: [yours] }
    expect(withWelcome(places, false)).toBe(places)
  })

  it('stays away while your places load', () => {
    expect(withWelcome(NO_PLACES, true)).toBe(NO_PLACES)
  })
})
