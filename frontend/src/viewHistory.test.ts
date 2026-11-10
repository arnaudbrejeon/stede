import { describe, expect, it } from 'vitest'
import { MAX_VIEWS, ViewHistory, type View } from './viewHistory'

const at = (lng: number, zoom = 12): View => ({ center: [lng, 50], zoom })
const [a, b, c, d] = [at(1), at(2), at(3), at(4)]
// Half a screen, in pixels. A degree of longitude at zoom 12 is some 5800.
const REACH = 300
// About 58 pixels east of `b` at zoom 12.
const nearB = at(2.01)

describe('view history', () => {
  it('has nowhere to go at first', () => {
    const history = new ViewHistory()
    expect(history.canGoBack(a, REACH)).toBe(false)
    expect(history.canGoForward()).toBe(false)
    expect(history.back(a, REACH)).toBeUndefined()
    expect(history.forward()).toBeUndefined()
  })

  it('steps back and forward through the views rested on', () => {
    const history = new ViewHistory()
    for (const view of [a, b, c]) history.record(view, REACH)
    expect(history.back(c, REACH)).toBe(b)
    expect(history.back(b, REACH)).toBe(a)
    expect(history.canGoBack(a, REACH)).toBe(false)
    expect(history.forward()).toBe(b)
    expect(history.forward()).toBe(c)
    expect(history.canGoForward()).toBe(false)
  })

  it('records a view once, however long the map stays', () => {
    const history = new ViewHistory()
    history.record(a, REACH)
    history.record(b, REACH)
    history.record({ center: [2 + 1e-9, 50], zoom: 12.001 }, REACH)
    expect(history.back(b, REACH)).toBe(a)
    expect(history.canGoBack(a, REACH)).toBe(false)
  })

  it('tells apart the same centre at another zoom', () => {
    const history = new ViewHistory()
    history.record(at(1, 12), REACH)
    history.record(at(1, 14), REACH)
    expect(history.back(at(1, 14), REACH)).toEqual(at(1, 12))
  })

  it('drops the views ahead when you go somewhere new', () => {
    const history = new ViewHistory()
    for (const view of [a, b, c]) history.record(view, REACH)
    history.back(c, REACH)
    history.record(d, REACH)
    expect(history.canGoForward()).toBe(false)
    expect(history.back(d, REACH)).toBe(b)
  })

  it('goes back from a view not yet recorded, and forward to it again', () => {
    const history = new ViewHistory()
    history.record(a, REACH)
    expect(history.canGoBack(b, REACH)).toBe(true)
    expect(history.back(b, REACH)).toBe(a)
    expect(history.forward()).toBe(b)
  })

  it('keeps one view for a stop, the last one', () => {
    const history = new ViewHistory()
    history.record(a, REACH)
    history.record(b, REACH)
    history.record(nearB, REACH)
    history.record(c, REACH)
    expect(history.back(c, REACH)).toBe(nearB)
    expect(history.back(nearB, REACH)).toBe(a)
  })

  it('counts a zoom step at the same centre as a new stop', () => {
    const history = new ViewHistory()
    history.record(at(1, 12), REACH)
    history.record(at(1, 11), REACH)
    expect(history.back(at(1, 11), REACH)).toEqual(at(1, 12))
  })

  it('keeps the views ahead when you only look around after stepping back', () => {
    const history = new ViewHistory()
    for (const view of [a, b, c]) history.record(view, REACH)
    history.back(c, REACH)
    history.record(nearB, REACH)
    expect(history.forward()).toBe(c)
    expect(history.back(c, REACH)).toBe(nearB)
  })

  it('has no way back from around the only view', () => {
    const history = new ViewHistory()
    history.record(b, REACH)
    expect(history.canGoBack(nearB, REACH)).toBe(false)
    expect(history.back(nearB, REACH)).toBeUndefined()
  })

  it('forgets the oldest views beyond the limit', () => {
    const history = new ViewHistory()
    for (let i = 0; i < MAX_VIEWS + 5; i++) history.record(at(i), REACH)
    let steps = 0
    let now = at(MAX_VIEWS + 4)
    for (let view = history.back(now, REACH); view; view = history.back(now, REACH)) {
      now = view
      steps += 1
    }
    expect(steps).toBe(MAX_VIEWS - 1)
    expect(now).toEqual(at(5))
  })
})
