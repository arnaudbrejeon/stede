import { existsSync, readFileSync } from 'node:fs'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run dev:lan` (mode "lan") serves over HTTPS, for testing on a phone on the
// same network: browsers only share your location with HTTPS pages (or localhost).
// Safari also wants a certificate it trusts, so a mkcert one in .cert/ is used
// when there is one (see README); otherwise a self-signed one.
const CERT = { key: '.cert/key.pem', cert: '.cert/cert.pem' }
const trustedCert = existsSync(CERT.key) && existsSync(CERT.cert)

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'lan' && !trustedCert ? [basicSsl()] : [])],
  build: {
    rollupOptions: {
      // icons.html, palette.html and brand.html are dev-only previews; ship just the app.
      input: 'index.html',
    },
  },
  worker: {
    // maplibre-gl starts its worker as a module worker.
    format: 'es',
  },
  server: {
    https:
      mode === 'lan' && trustedCert
        ? { key: readFileSync(CERT.key), cert: readFileSync(CERT.cert) }
        : undefined,
    proxy: {
      // Backend dev server; override with API_URL=http://localhost:PORT.
      '/api': process.env.API_URL ?? 'http://localhost:8000',
      // The Nostr relay (strfry, see relay/), on the app's own origin so an HTTPS
      // page reaches it over wss://; override with RELAY_URL=ws://host:port.
      '/relay': {
        target: process.env.RELAY_URL ?? 'ws://localhost:7777',
        ws: true,
        rewrite: (path) => path.replace(/^\/relay/, '') || '/',
      },
    },
  },
}))
