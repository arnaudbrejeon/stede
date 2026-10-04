import { useEffect, type ReactNode, type Ref } from 'react'

type DrawerProps = {
  open: boolean
  onClose: () => void
  label: string
  // Visual flavour: 'adding' tints it like the add-a-place button.
  variant?: 'adding'
  children?: ReactNode
  ref?: Ref<HTMLElement>
}

// Slides up from the bottom on small portrait screens and in from the right
// otherwise; the placement is handled entirely in CSS.
export function Drawer({ open, onClose, label, variant, children, ref }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <aside
      ref={ref}
      className={`drawer${open ? ' open' : ''}${variant ? ` ${variant}` : ''}`}
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="drawer-handle" aria-hidden="true" />
      <button type="button" className="drawer-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {open && <div className="drawer-body">{children}</div>}
    </aside>
  )
}
