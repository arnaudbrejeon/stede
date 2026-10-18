import { existsSync, readFileSync } from 'node:fs'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// `npm run dev:lan` (mode "lan") serves over HTTPS, for testing on a phone on the
// same network: browsers only share your location with HTTPS pages (or localhost).
// Safari also wants a certificate it trusts, so a mkcert one in .cert/ is used
// when there is one (see README); otherwise a self-signed one.
const CERT = { key: '.cert/key.pem', cert: '.cert/cert.pem' }
const trustedCert = existsSync(CERT.key) && existsSync(CERT.cert)

// The API (worker/index.ts, a Cloudflare Worker in production), run by the dev
// server for /api/*, reloaded with the rest of the code.
function api(): Plugin {
  return {
    name: 'stede-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const worker = await server.ssrLoadModule('/worker/index.ts')
          const request = new Request(new URL(req.url, 'http://localhost'), { method: req.method })
          const response: Response = await worker.default.fetch(request, {}, undefined)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), api(), ...(mode === 'lan' && !trustedCert ? [basicSsl()] : [])],
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
