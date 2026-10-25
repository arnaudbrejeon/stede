// Links opening a place in other maps, by its coordinates, so they work for
// any place, matched to OpenStreetMap or not.
//   Apple: https://developer.apple.com/documentation/mapkit/unified-map-urls
//   Google: https://developers.google.com/maps/documentation/urls/get-started

import type { LngLat } from './components/PlacesMap'

// Six decimals: about a tenth of a metre, enough for any pin.
const coordinate = ([lon, lat]: LngLat) => `${lat.toFixed(6)},${lon.toFixed(6)}`

// A place card at the point, carrying the place's name (iOS 18.4, macOS 15.4
// and the web; older Apple Maps still open the point).
export function appleMapsUrl(lngLat: LngLat, name: string): string {
  return `https://maps.apple.com/place?coordinate=${coordinate(lngLat)}&name=${encodeURIComponent(name)}`
}

// A pin at the point. The search action takes a name or address too, but
// coordinates can't mismatch; a place card would need Google's place id.
export function googleMapsUrl(lngLat: LngLat): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinate(lngLat))}`
}
