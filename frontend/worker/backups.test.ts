import { describe, expect, it } from 'vitest'
import { backupStatus, nextBackup } from './backups'
import { fakeFetch } from './fakeFetch'
import { handle } from './index'

// A service account key as Google writes it, with a key made for the test.
async function serviceAccountKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`
  return JSON.stringify({
    client_email: 'reader@stede-cc.iam.gserviceaccount.com',
    private_key: pem,
    token_uri: 'https://oauth2.googleapis.com/token',
  })
}

const object = (day: number, size: number) => ({
  name: `strfry-2026-11-${day}T090026Z.jsonl.gz`,
  size: String(size),
  timeCreated: `2026-11-${day}T09:00:26.000Z`,
})

function google(items: object[] | undefined) {
  return fakeFetch((url, init) => {
    if (url.host === 'oauth2.googleapis.com') {
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('assertion')?.split('.')).toHaveLength(3)
      return Response.json({ access_token: 'token', expires_in: 3600 })
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token')
    return Response.json(items ? { items } : {})
  })
}

describe('backupStatus', () => {
  it('finds the latest backup in the bucket', async () => {
    const fetch = google([object(20, 100), object(21, 120), object(19, 90)])
    const status = await backupStatus(
      fetch,
      'stede-cc-relay-backups',
      await serviceAccountKey(),
      new Date('2026-11-21T22:00:00Z'),
    )
    expect(status).toEqual({
      latest: { at: '2026-11-21T09:00:26.000Z', bytes: 120 },
      kept: 3,
      next: '2026-11-22T09:00:00.000Z',
    })
    expect(fetch.calls[1].pathname).toBe('/storage/v1/b/stede-cc-relay-backups/o')
  })

  it('says when there is none yet', async () => {
    const status = await backupStatus(google(undefined), 'b', await serviceAccountKey())
    expect(status.latest).toBeNull()
    expect(status.kept).toBe(0)
  })

  it('fails when the bucket refuses', async () => {
    const fetch = fakeFetch((url) =>
      url.host === 'oauth2.googleapis.com'
        ? Response.json({ access_token: 'token' })
        : new Response('', { status: 403 }),
    )
    await expect(backupStatus(fetch, 'b', await serviceAccountKey())).rejects.toThrow('403')
  })
})

describe('nextBackup', () => {
  it.each([
    ['2026-11-21T08:59:00Z', '2026-11-21T09:00:00.000Z'],
    ['2026-11-21T09:00:00Z', '2026-11-22T09:00:00.000Z'],
    ['2026-11-30T23:00:00Z', '2026-12-01T09:00:00.000Z'],
  ])('%s -> %s', (now, next) => {
    expect(nextBackup(new Date(now)).toISOString()).toBe(next)
  })
})

describe('/api/backups', () => {
  it('answers 503 when not configured', async () => {
    const response = await handle(new Request('https://stede.cc/api/backups'), google([]))
    expect(response.status).toBe(503)
  })

  it('answers with the status', async () => {
    const request = new Request('https://stede.cc/api/backups')
    const response = await handle(request, google([]), undefined, {
      BACKUP_BUCKET: 'b',
      BACKUP_READER_KEY: await serviceAccountKey(),
    })
    expect(response.status).toBe(200)
    expect((await response.json()).kept).toBe(0)
  })
})
