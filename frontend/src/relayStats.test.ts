import { describe, expect, it } from 'vitest'
import { histogram, parseAuthors } from './relayStats'

describe('the relay authors file', () => {
  it('reads one pubkey a line, ignoring comments and blank lines', () => {
    const text = `# Pubkeys allowed to write.
# npub1…
030A01EAE57B9088E0CF96465791D272C9F69B07DDB48F877009A013950A5B8F

bfe0d6f06d1f8bff49e6a4be5a940655b7d863bcd9109044af7f10330491e579 # trailing note
`
    expect(parseAuthors(text)).toEqual([
      '030a01eae57b9088e0cf96465791d272c9f69b07ddb48f877009a013950a5b8f',
      'bfe0d6f06d1f8bff49e6a4be5a940655b7d863bcd9109044af7f10330491e579',
    ])
  })

  it('lists a repeated pubkey once', () => {
    expect(parseAuthors('ab\nab\nAB')).toEqual(['ab'])
  })
})

describe('the histogram of authors by their number of events', () => {
  const counts = (...counts: number[]) => counts.map((count, i) => ({ pubkey: `${i}`, count }))

  it('buckets authors by powers of ten, including those with nothing', () => {
    const buckets = histogram(counts(0, 1, 9, 10, 6152, 12140, 10000))
    expect(buckets.map((b) => [b.label, b.authors])).toEqual([
      ['0', 1],
      ['1–9', 2],
      ['10–99', 1],
      ['100–999', 0],
      ['1,000–9,999', 1],
      ['10,000+', 2],
    ])
  })

  it('keeps every bucket with no authors at all', () => {
    expect(histogram([]).map((b) => b.authors)).toEqual([0, 0, 0, 0, 0, 0])
  })
})
