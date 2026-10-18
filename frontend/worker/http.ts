// Outgoing requests: every one names stede and gives up after a few seconds.

export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export const USER_AGENT = 'stede/0.1 (+https://stede.cc)'
const TIMEOUT_MS = 5000

export function withDefaults(fetchImpl: Fetch): Fetch {
  return (input, init = {}) => {
    const headers = new Headers(init.headers)
    if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT)
    return fetchImpl(input, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })
  }
}

// Great-circle distance in metres (haversine).
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const dphi = (lat2 - lat1) * rad
  const dlmb = (lon2 - lon1) * rad
  const a =
    Math.sin(dphi / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlmb / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a))
}
