import { useEffect, useRef } from 'react'
import portrait from '../assets/chaucer-ellesmere.jpg'
import { Logo } from './Logo'

const PORTRAIT_SOURCE =
  'https://commons.wikimedia.org/wiki/File:Geoffrey_Chaucer,_Tale_of_Melibee,_Ellesmere_Chaucer,_mssEL_26_C_9,_folio_153v_cropped_tight.jpg'

// Each line in Chaucer's Middle English, with a word-for-word modern gloss
// under it (ours, not a published translation: kindly = natural, by its
// nature; stede = place; hit = it; conserved = preserved).
const VERSE = [
  ['Every kindly thing that is', 'Every natural thing that is'],
  ['Hath a kindly stede ther he', 'has a natural place where it'],
  ['May best in hit conserved be', 'may best be preserved'],
]

type AboutDialogProps = {
  open: boolean
  onClose: () => void
}

// Where the name comes from: Chaucer's line about everything having its place,
// with his portrait from the Ellesmere manuscript (which the logo is traced from).
export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="about"
      aria-labelledby="about-title"
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself, outside its content.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="about-body">
        <button type="button" className="about-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <figure className="about-portrait">
          {open && (
            <img
              src={portrait}
              width={776}
              height={920}
              alt="Chaucer on horseback, pointing, beside an illuminated initial"
            />
          )}
          <figcaption>
            Chaucer, from the Ellesmere manuscript of the Canterbury Tales, England, 1400–1410.
            Huntington Library, mssEL 26 C 9, f. 153v.{' '}
            <a href={PORTRAIT_SOURCE} target="_blank" rel="noopener">
              Public domain
            </a>
          </figcaption>
        </figure>
        <div className="about-text">
          <h2 id="about-title">
            <Logo size={40} />
            Stede
          </h2>
          <blockquote className="about-verse">
            {VERSE.map(([line, modern]) => (
              <p key={line}>
                <span className="about-line" lang="enm">
                  {line}
                </span>
                <span className="about-modern">{modern}</span>
              </p>
            ))}
          </blockquote>
          <p className="about-cite">
            Geoffrey Chaucer, <cite>The House of Fame</cite>, Book II
          </p>
        </div>
      </div>
    </dialog>
  )
}
