import { useEffect, type RefObject } from 'react'

// Tracks how much of the element's bottom the browser hides: its toolbar, the
// home indicator, or the on-screen keyboard. Phones don't move the page for the
// keyboard, they only shrink the visible area (the visual viewport), so this is
// the one way to keep the controls along the bottom, and the end of the phone
// sheet, above it. Sets on the element:
//   --screen-height   px of the screen's height (phones make the app this tall)
//   --hidden-bottom   px of the element below the visible area
//   --visible-height  px of the visible area
export function useHiddenBottom(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport
    const el = ref.current
    if (!viewport || !el) return
    const update = () => {
      // Pinch-zooming also shrinks the visible area; that's not something covering it.
      if (viewport.scale > 1.01) return
      // screen.width and height don't swap when the phone turns on iOS.
      const long = Math.max(screen.width, screen.height)
      const short = Math.min(screen.width, screen.height)
      const portrait = window.innerHeight >= window.innerWidth
      el.style.setProperty('--screen-height', `${portrait ? long : short}px`)
      const visibleBottom = viewport.offsetTop + viewport.height
      const hidden = Math.max(0, el.getBoundingClientRect().bottom - visibleBottom)
      el.style.setProperty('--hidden-bottom', `${Math.round(hidden)}px`)
      el.style.setProperty('--visible-height', `${Math.round(viewport.height)}px`)
    }
    // On phones the app is taller than the window (it runs behind the
    // toolbar), so Safari scrolls the page to bring a focused field above the
    // keyboard, and only partly back once the keyboard closes, leaving the
    // header off the top. The page never scrolls otherwise, and the sheet
    // already keeps its content above the keyboard: put the page back.
    const unscroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', unscroll)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', unscroll)
    }
  }, [ref])
}
