// Serves stede.cc on Cloudflare: the built app is static assets, served by
// Cloudflare directly; this worker only runs for /api/*, which it passes to the
// API on api.stede.cc (see wrangler.jsonc and docs/deploy.md).

type Env = { API_ORIGIN: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 })
    return fetch(new Request(new URL(url.pathname + url.search, env.API_ORIGIN), request))
  },
}
