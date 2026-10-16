import { describe, expect, it } from 'vitest'
import { BEEN_THERE, starsOf, tagLabel, TO_TRY, withDefaultTag } from './tags'

describe('default tags', () => {
  it('keeps "to try" and "been there" apart', () => {
    expect(withDefaultTag(['art', TO_TRY], BEEN_THERE, true)).toEqual(['art', BEEN_THERE])
    expect(withDefaultTag(['art', BEEN_THERE, '4 stars'], TO_TRY, true)).toEqual(['art', TO_TRY])
  })

  it('makes a rating mean you have been there', () => {
    expect(withDefaultTag(['art', TO_TRY], '4 stars', true)).toEqual(['art', BEEN_THERE, '4 stars'])
    expect(withDefaultTag([BEEN_THERE, '4 stars'], '2 stars', true)).toEqual([BEEN_THERE, '2 stars'])
    expect(starsOf([BEEN_THERE, '2 stars'])).toBe(2)
    expect(starsOf(['art'])).toBe(0)
  })

  it('clears the rating with "been there"', () => {
    expect(withDefaultTag([BEEN_THERE, '3 stars', 'art'], BEEN_THERE, false)).toEqual(['art'])
    expect(withDefaultTag([BEEN_THERE, '3 stars'], '3 stars', false)).toEqual([BEEN_THERE])
  })

  it('reads labels nicely', () => {
    expect(tagLabel('to try')).toBe('To try')
    expect(tagLabel('1 star')).toBe('★')
    expect(tagLabel('5 stars')).toBe('★★★★★')
  })
})
