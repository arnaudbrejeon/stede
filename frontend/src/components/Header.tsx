import { Logo } from './Logo'

export function Header() {
  return (
    <header className="header">
      <Logo />
      <span className="header-name">Stede</span>
      <q className="header-quote">
        Every kindly thing that is · Hath a kindly stede ther he · May best in hit conserved be
      </q>
    </header>
  )
}
