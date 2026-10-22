import { describe, expect, it } from 'vitest'
import { describeStatus, parseOpeningHours, whenLabel, type Where } from './openingHours'

// Paris, no country: holidays aren't known.
const PARIS: Where = { lngLat: [2.35, 48.85] }
const FRANCE: Where = { ...PARIS, countryCode: 'FR' }

// A Thursday.
const at = (time: string, day = '2026-10-22') => new Date(`${day}T${time}:00`)

describe('opening status', () => {
  it('says open, closing soon or closed from the hours', async () => {
    const hours = await parseOpeningHours('Mo-Fr 12:00-14:00, 18:00-22:00; Sa 18:00-23:00; Su off', PARIS)
    expect(hours!.status(at('12:30'))).toEqual({ state: 'open', until: at('14:00') })
    expect(hours!.status(at('13:30'))).toEqual({ state: 'closing', until: at('14:00') })
    expect(hours!.status(at('15:00'))).toEqual({ state: 'closed', opens: at('18:00') })
    // Sunday: the next opening is Monday noon.
    expect(hours!.status(at('15:00', '2026-10-25'))).toEqual({
      state: 'closed',
      opens: at('12:00', '2026-10-26'),
    })
  })

  it('has no closing time for 24/7', async () => {
    const hours = await parseOpeningHours('24/7', PARIS)
    expect(hours!.status(at('03:00'))).toEqual({ state: 'open' })
  })

  it('reports what it cannot tell', async () => {
    const hours = await parseOpeningHours('Mo-Fr 09:00-17:00 "by appointment"', PARIS)
    expect(hours!.status(at('10:00'))).toEqual({ state: 'unknown', comment: 'by appointment' })
    expect(hours!.status(at('20:00'))).toEqual({ state: 'closed', opens: at('09:00', '2026-10-23') })
  })

  it('knows public holidays when the country is known', async () => {
    const armistice = at('10:00', '2026-11-11')
    const withHolidays = await parseOpeningHours('Mo-Su 08:00-22:00; PH off', FRANCE)
    expect(withHolidays!.status(armistice).state).toBe('closed')
    // Without the country, a holiday is an ordinary day rather than an error.
    const without = await parseOpeningHours('Mo-Su 08:00-22:00; PH off', PARIS)
    expect(without!.status(armistice).state).toBe('open')
  })

  it('rejects values it cannot read', async () => {
    expect(await parseOpeningHours('ask at the bar', PARIS)).toBeNull()
    expect(await parseOpeningHours('', PARIS)).toBeNull()
  })
})

describe('status wording', () => {
  const now = at('13:30')
  it('names the status and the next change', () => {
    expect(describeStatus({ state: 'open', until: at('14:00') }, now, 'en-GB')).toBe(
      'Open · closes at 14:00',
    )
    expect(describeStatus({ state: 'open' }, now, 'en-GB')).toBe('Open')
    expect(describeStatus({ state: 'closing', until: at('14:00') }, now, 'en-GB')).toBe(
      'Closing soon · at 14:00',
    )
    expect(describeStatus({ state: 'closed', opens: at('09:00', '2026-10-23') }, now, 'en-GB')).toBe(
      'Closed · opens tomorrow at 09:00',
    )
    expect(describeStatus({ state: 'closed', opens: at('12:00', '2026-10-26') }, now, 'en-GB')).toBe(
      'Closed · opens Monday at 12:00',
    )
    expect(describeStatus({ state: 'closed' }, now, 'en-GB')).toBe('Closed')
    expect(describeStatus({ state: 'unknown', comment: 'by appointment' }, now, 'en-GB')).toBe(
      'By appointment',
    )
    expect(describeStatus({ state: 'unknown' }, now, 'en-GB')).toBe('Hours vary')
  })

  it('counts calendar days, not 24-hour spans', () => {
    expect(whenLabel(at('01:00', '2026-10-23'), at('23:30'), 'en-GB')).toBe('tomorrow at 01:00')
  })
})
