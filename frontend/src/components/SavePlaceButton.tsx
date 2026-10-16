import { useState } from 'react'
import type { PlaceDraft } from '../placeEvents'
import type { Place } from '../places'
import { savePlace } from '../placeStore'

type SavePlaceButtonProps = {
  // null while there isn't enough to save yet (e.g. no name).
  draft: PlaceDraft | null
  onSaved: (place: Place) => void
}

export function SavePlaceButton({ draft, onSaved }: SavePlaceButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await savePlace(draft))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="save-place">
      <button type="button" className="key-button" disabled={!draft || busy} onClick={save}>
        {busy ? 'Saving…' : 'Save place'}
      </button>
      {error && <p className="key-error">{error}</p>}
    </div>
  )
}
