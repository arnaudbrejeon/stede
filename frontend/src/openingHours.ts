// An OpenStreetMap opening_hours value (https://wiki.openstreetmap.org/wiki/Key:opening_hours)
// read with opening_hours.js, to say whether a place is open right now.
//
// The library is 120 KB gzipped (it carries every country's public holidays), so
// it is only loaded once a place with hours is opened. Times are the browser's:
// a place in another time zone is judged by the clock here, not there.
import type { nominatim_object, opening_hours as OpeningHours } from 'opening_hours'

// Where the place is: sunrise and sunset need its position, public holidays
// (PH) its country.
export type Where = {
  lngLat: [number, number]
  // ISO 3166-1 alpha-2, as Photon gives it.
  countryCode?: string
}

export type OpeningStatus =
  // Open, and the next closing time when there is one (not for 24/7).
  | { state: 'open'; until?: Date }
  // Open, but closing within CLOSING_SOON_MS.
  | { state: 'closing'; until: Date }
  // Closed; `opens` is the next opening, when within a week.
  | { state: 'closed'; opens?: Date }
  // The value can't say (e.g. "by appointment"); `comment` is its own words.
  | { state: 'unknown'; comment?: string }

export const CLOSING_SOON_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type ParsedHours = { status: (now: Date) => OpeningStatus }

// Null when the value isn't valid opening_hours syntax.
export async function parseOpeningHours(value: string, where: Where): Promise<ParsedHours | null> {
  const { default: OpeningHours } = await import('opening_hours')
  const oh = construct(OpeningHours, value, where)
  return oh && { status: (now) => statusOf(oh, now) }
}

type Constructor = typeof OpeningHours

// Holidays need the country; without it the library throws for values that
// mention PH, so those are read again as if there were no holidays. (Without
// a place at all, PH days count as ordinary days and sunrise is wherever the
// library assumes.)
function construct(OpeningHours: Constructor, value: string, where: Where): OpeningHours | null {
  const [lon, lat] = where.lngLat
  const attempts: (nominatim_object | null)[] = [null]
  if (where.countryCode) {
    const address = { country_code: where.countryCode.toLowerCase(), state: '' }
    attempts.unshift({ lat, lon, address })
  }
  for (const nominatim of attempts) {
    try {
      const oh = new OpeningHours(value, nominatim)
      // Values the library parses but can't evaluate throw on first use.
      oh.getState(new Date())
      return oh
    } catch {
      // Try the next, looser reading.
    }
  }
  return null
}

export function statusOf(oh: OpeningHours, now: Date): OpeningStatus {
  if (oh.getUnknown(now)) return { state: 'unknown', comment: oh.getComment(now) }
  const change = oh.getNextChange(now, new Date(now.getTime() + WEEK_MS))
  if (oh.getState(now)) {
    if (change && change.getTime() - now.getTime() <= CLOSING_SOON_MS)
      return { state: 'closing', until: change }
    return change ? { state: 'open', until: change } : { state: 'open' }
  }
  return change ? { state: 'closed', opens: change } : { state: 'closed' }
}

// "Open · closes at 14:00", "Closing soon · at 14:00", "Closed · opens
// tomorrow at 09:00", "By appointment"…
export function describeStatus(status: OpeningStatus, now: Date, locale?: string): string {
  switch (status.state) {
    case 'open':
      return status.until ? `Open · closes ${whenLabel(status.until, now, locale)}` : 'Open'
    case 'closing':
      return `Closing soon · ${whenLabel(status.until, now, locale)}`
    case 'closed':
      return status.opens ? `Closed · opens ${whenLabel(status.opens, now, locale)}` : 'Closed'
    case 'unknown':
      return status.comment ? capitalize(status.comment) : 'Hours vary'
  }
}

// "at 14:00" today, "tomorrow at 09:00", else "Monday at 09:00".
export function whenLabel(date: Date, now: Date, locale?: string): string {
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const days = daysBetween(now, date)
  if (days === 0) return `at ${time}`
  if (days === 1) return `tomorrow at ${time}`
  const weekday = date.toLocaleDateString(locale, { weekday: 'long' })
  return `${weekday} at ${time}`
}

// Calendar days from `from` to `to`, in local time.
function daysBetween(from: Date, to: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((start(to) - start(from)) / (24 * 60 * 60 * 1000))
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
