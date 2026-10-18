// A stand-in for fetch in tests: answers each request with `answer`, and keeps
// the URLs asked for.

import type { Fetch } from './http'

export type FakeFetch = Fetch & { calls: URL[] }

export function fakeFetch(answer: (url: URL, init?: RequestInit) => Response): FakeFetch {
  const calls: URL[] = []
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(url)
    return answer(url, init)
  }) as FakeFetch
  fetch.calls = calls
  return fetch
}

export const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

export const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } })
