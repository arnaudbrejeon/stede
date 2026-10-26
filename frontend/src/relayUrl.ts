// Served through the dev server (/relay, see vite.config.ts), so the app reaches
// the relay on the same origin, over wss:// when the page is HTTPS.
export const RELAY_URL =
  import.meta.env.VITE_RELAY_URL ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`
