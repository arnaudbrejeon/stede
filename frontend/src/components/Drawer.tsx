import { useCallback, useEffect, useRef, type ReactNode, type Ref } from 'react'

type DrawerProps = {
  open: boolean
  onClose: () => void
  label: string
  // Visual flavour: 'adding' tints it like the add-a-place button.
  variant?: 'adding'
  children?: ReactNode
  ref?: Ref<HTMLElement>
}

// A page over the whole screen on small portrait screens, a panel sliding in
// from the right otherwise; the placement is handled entirely in CSS.
export function Drawer({ open, onClose, label, variant, children, ref }: DrawerProps) {
  const asideRef = useRef<HTMLElement | null>(null)
  const setAside = useCallback(
    (node: HTMLElement | null) => {
      asideRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // On touch screens the on-screen keyboard leaves little of the drawer in
  // view, and the browser only scrolls a focused field just into it, along
  // the bottom edge. Bring the field and its label to the top instead, below
  // the close button, so what follows shows; index.css leaves room under the
  // content for the last field to get there. Not the search field: on phones
  // it is pinned at the top already.
  useEffect(() => {
    const aside = asideRef.current
    if (!open || !aside || !window.matchMedia('(hover: none) and (pointer: coarse)').matches) return
    const raise = (e: FocusEvent) => {
      const field = e.target
      if (!(field instanceof HTMLElement) || !field.matches('input, textarea')) return
      if (field.closest('.search-bar')) return
      const anchor = field.closest('.field, label') ?? field
      const top = anchor.getBoundingClientRect().top - aside.getBoundingClientRect().top
      aside.scrollTop += top - 44
    }
    aside.addEventListener('focusin', raise)
    return () => aside.removeEventListener('focusin', raise)
  }, [open])

  return (
    <aside
      ref={setAside}
      className={`drawer${open ? ' open' : ''}${variant ? ` ${variant}` : ''}`}
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
    >
      <button type="button" className="drawer-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {open && <div className="drawer-body">{children}</div>}
    </aside>
  )
}
