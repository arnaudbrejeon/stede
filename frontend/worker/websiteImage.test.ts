import { describe, expect, it } from 'vitest'
import { fakeFetch, html, redirect } from './fakeFetch'
import {
  checkPublicUrl,
  extractImage,
  findWebsiteImage,
  photoCandidates,
  UnsafeURLError,
} from './websiteImage'

const image = (size: number) =>
  new Response(null, { headers: { 'content-type': 'image/jpeg', 'content-length': String(size) } })

describe('extractImage', () => {
  it('prefers og:image and resolves relative URLs', () => {
    const page = `<head>
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
      <meta property="og:image" content="/img/cover.jpg">
    </head>`
    expect(extractImage(page, 'https://example.com/page')).toBe('https://example.com/img/cover.jpg')
  })

  it('is null without tags or with a non-http image', () => {
    expect(extractImage('<head><title>x</title></head>', 'https://example.com')).toBeNull()
    expect(
      extractImage(
        '<meta property="og:image" content="javascript:alert(1)">',
        'https://example.com',
      ),
    ).toBeNull()
  })

  it('reads attributes in any order and quoting, with entities', () => {
    const page = "<meta content='/a.jpg?x=1&amp;y=2' property=og:image>"
    expect(extractImage(page, 'https://example.com/')).toBe('https://example.com/a.jpg?x=1&y=2')
  })
})

describe('checkPublicUrl', () => {
  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'http://localhost/',
    'http://127.0.0.1:8000/api/health',
    'http://10.0.0.5/',
    'http://172.20.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://user:pass@example.com/',
  ])('rejects %s', (url) => {
    expect(() => checkPublicUrl(url)).toThrow(UnsafeURLError)
  })

  it('accepts public hosts', () => {
    expect(() => checkPublicUrl('https://www.example.com/page')).not.toThrow()
    expect(() => checkPublicUrl('http://93.184.215.14/')).not.toThrow()
  })
})

describe('findWebsiteImage', () => {
  it('follows redirects and checks each hop', async () => {
    const fetch = fakeFetch((url) =>
      url.pathname === '/start'
        ? redirect('http://10.0.0.1/admin')
        : html('<meta property="og:image" content="/x.jpg">'),
    )
    await expect(findWebsiteImage('https://public.example/start', fetch)).rejects.toThrow(
      UnsafeURLError,
    )
    expect(fetch.calls.map(String)).toEqual(['https://public.example/start'])
  })

  it('finds the image after a safe redirect', async () => {
    const fetch = fakeFetch((url) =>
      url.pathname === '/'
        ? redirect('/fr/', 301)
        : html('<meta property="og:image" content="cover.jpg">'),
    )
    expect(await findWebsiteImage('https://site.example/', fetch)).toBe(
      'https://site.example/fr/cover.jpg',
    )
  })

  it('falls back to a photo when the page has no preview image', async () => {
    const fetch = fakeFetch((url) => {
      if (url.pathname === '/') return html('<img src="/img/tiny.jpg"><img src="/img/terrace.jpg">')
      return image(url.pathname.includes('tiny') ? 2_000 : 150_000)
    })
    // tiny.jpg comes first on the page but is too small to be a photo.
    expect(await findWebsiteImage('https://bistro.example/', fetch)).toBe(
      'https://bistro.example/img/terrace.jpg',
    )
  })

  it('upgrades http images to https when available', async () => {
    const fetch = fakeFetch((url) =>
      url.pathname === '/' ? html('<img src="http://cdn.example/oven.jpg">') : image(90_000),
    )
    expect(await findWebsiteImage('https://pizzeria.example/', fetch)).toBe(
      'https://cdn.example/oven.jpg',
    )
  })

  it('checks https first when http gets a bot challenge', async () => {
    const fetch = fakeFetch((url) => {
      if (url.pathname === '/') return html('<img src="http://host.example/oven.jpg">')
      if (url.protocol === 'http:') return html('<html>challenge</html>', 202) // e.g. SiteGround's anti-bot page
      return image(380_000)
    })
    expect(await findWebsiteImage('https://restaurant.example/', fetch)).toBe(
      'https://host.example/oven.jpg',
    )
  })
})

describe('photoCandidates', () => {
  it('skips logos and small sizes and prefers large ones', () => {
    const page = `
      <img src="/wp-content/uploads/2025/02/MagpiesLogo2023-scaled.png">
      <img src="https://cdn.example.com/icons/favicon-192x192.png">
      <img src="/wp-content/uploads/2025/02/storefront-300x200.jpg">
      <div style="background-image: url('//static.showit.co/200/abc/1/patio.jpg')"></div>
      <img src="https://cdn.example.com/thumb.jpg?w=120">
    `
    // Resized copies point at their large version; logos, icons and tiny images are gone.
    expect(photoCandidates(page, 'https://shop.example/')).toEqual([
      'https://static.showit.co/1200/abc/1/patio.jpg',
      'https://shop.example/wp-content/uploads/2025/02/storefront.jpg',
    ])
  })

  it('finds URLs inside embedded JSON', () => {
    const page = '<script>{"hero":"https:\\/\\/img.example.com\\/dining-room.webp"}</script>'
    expect(photoCandidates(page, 'https://x.example/')).toEqual([
      'https://img.example.com/dining-room.webp',
    ])
  })
})
