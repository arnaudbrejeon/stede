import { useState } from 'react'
import { useKey } from '../keystore'
import { AboutDialog } from './AboutDialog'
import { Logo } from './Logo'

type HeaderProps = {
  onKeyClick: () => void
}

export function Header({ onKeyClick }: HeaderProps) {
  const { status } = useKey()
  const [about, setAbout] = useState(false)
  const label =
    status === 'unlocked'
      ? 'Your key (unlocked)'
      : status === 'locked'
        ? 'Your key (locked)'
        : 'Add your key'
  return (
    <header className="header">
      <button
        type="button"
        className="brand"
        aria-haspopup="dialog"
        title="About the name"
        onClick={() => setAbout(true)}
      >
        <Logo />
        <span className="header-name">Stede</span>
      </button>
      <AboutDialog open={about} onClose={() => setAbout(false)} />
      <button
        type="button"
        className={`header-key ${status}`}
        aria-label={label}
        title={label}
        onClick={onKeyClick}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          {status === 'unlocked' ? (
            <path
              d="M6.5 9V6.5a3.5 3.5 0 0 1 6.8-1.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          )}
          <rect x="4.5" y="9" width="11" height="8" rx="1.6" fill="currentColor" />
        </svg>
      </button>
    </header>
  )
}
