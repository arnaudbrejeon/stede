import { useEffect, useState } from 'react'
import { describeStatus, parseOpeningHours, type OpeningStatus, type ParsedHours, type Where } from './openingHours'

// How often the status is looked at again while the place stays open on screen.
const TICK_MS = 30 * 1000

export type OpeningNow = { state: OpeningStatus['state']; label: string }

// Whether the place is open now, from its OSM opening_hours value: undefined
// while the value is being read (or there is none), null when it can't be read.
export function useOpeningHours(value: string | undefined, where: Where): OpeningNow | null | undefined {
  const [lng, lat] = where.lngLat
  const { countryCode } = where
  const key = `${value}|${lng},${lat}|${countryCode ?? ''}`
  // The reading of `key`; another key's reading is not shown while it loads.
  const [parsed, setParsed] = useState<{ key: string; hours: ParsedHours | null }>()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!value) return
    let stale = false
    parseOpeningHours(value, { lngLat: [lng, lat], countryCode }).then(
      (hours) => {
        if (!stale) setParsed({ key, hours })
      },
      (err) => {
        console.error(err)
        if (!stale) setParsed({ key, hours: null })
      },
    )
    return () => {
      stale = true
    }
  }, [key, value, lng, lat, countryCode])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  if (!value || parsed?.key !== key) return undefined
  if (!parsed.hours) return null
  const status = parsed.hours.status(now)
  return { state: status.state, label: describeStatus(status, now, navigator.language) }
}
