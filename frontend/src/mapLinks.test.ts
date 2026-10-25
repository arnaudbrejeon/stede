import { describe, expect, it } from 'vitest'
import { appleMapsUrl, googleMapsUrl } from './mapLinks'

const abbey: [number, number] = [-0.12737, 51.49932]

describe('map links', () => {
  it('opens a named place card in Apple Maps', () => {
    expect(appleMapsUrl(abbey, 'Westminster Abbey & Cloisters')).toBe(
      'https://maps.apple.com/place?coordinate=51.499320,-0.127370&name=Westminster%20Abbey%20%26%20Cloisters',
    )
  })

  it('drops a pin in Google Maps', () => {
    expect(googleMapsUrl(abbey)).toBe(
      'https://www.google.com/maps/search/?api=1&query=51.499320%2C-0.127370',
    )
  })
})
