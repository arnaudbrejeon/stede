// Where the map has been: the views it rested on, to step back and forward
// through like a browser's history.

export type View = {
  // [longitude, latitude]
  center: [number, number]
  zoom: number
}

// How long the map must stay put before the view counts as somewhere you've been.
export const SETTLE_MS = 2_000
// The oldest views are forgotten beyond this.
export const MAX_VIEWS = 50

// Views this close in zoom, with centres within reach of each other, are one
// stop: looking around a neighbourhood isn't going somewhere else.
const SAME_STOP_ZOOM = 0.9

export class ViewHistory {
  private views: View[] = []
  // The view last rested on or stepped to; -1 while there's none.
  private index = -1

  get isEmpty(): boolean {
    return this.index < 0
  }

  // The map has rested on a view. `reach` is how far, in screen pixels, its
  // centre can be from the last view's and still be the same stop: the view
  // then replaces that one, so coming back lands where you ended up. As in a
  // browser, arriving somewhere new after stepping back drops the views that
  // were ahead.
  record(view: View, reach: number): void {
    if (!this.isNewStop(view, reach)) {
      this.views[this.index] = view
      return
    }
    this.views.length = this.index + 1
    this.views.push(view)
    if (this.views.length > MAX_VIEWS) this.views.shift()
    this.index = this.views.length - 1
  }

  // Whether resting on a view would add a stop, rather than replace the last.
  isNewStop(view: View, reach: number): boolean {
    return this.index < 0 || !sameStop(this.views[this.index], view, reach)
  }

  // `now` is the view on screen, which may not have rested long enough to be
  // recorded: stepping back from it first returns to the last recorded view.
  canGoBack(now: View, reach: number): boolean {
    return this.index > 0 || (this.index === 0 && !sameStop(this.views[0], now, reach))
  }

  canGoForward(): boolean {
    return this.index < this.views.length - 1
  }

  // The view to show, if there's one to go back to. The view left is recorded
  // first, so going forward returns to it.
  back(now: View, reach: number): View | undefined {
    if (!this.canGoBack(now, reach)) return undefined
    this.record(now, reach)
    this.index -= 1
    return this.views[this.index]
  }

  forward(): View | undefined {
    if (!this.canGoForward()) return undefined
    this.index += 1
    return this.views[this.index]
  }
}

function sameStop(a: View, b: View, reach: number): boolean {
  if (Math.abs(a.zoom - b.zoom) >= SAME_STOP_ZOOM) return false
  const [ax, ay] = worldPixels(a.center, a.zoom)
  const [bx, by] = worldPixels(b.center, a.zoom)
  // At least a pixel, for the rounding of an animation back to a view.
  return Math.hypot(ax - bx, ay - by) < Math.max(reach, 1)
}

// Web Mercator position in screen pixels at a zoom, as MapLibre lays out the world.
function worldPixels([lng, lat]: [number, number], zoom: number): [number, number] {
  const size = 512 * 2 ** zoom
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return [((lng + 180) / 360) * size, ((1 - y / Math.PI) / 2) * size]
}
