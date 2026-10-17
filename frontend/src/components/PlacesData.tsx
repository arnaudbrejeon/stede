import { useRef, useState } from 'react'
import {
  deleteAllPlaces,
  exportPlaces,
  importPlaces,
  usePlaces,
  type ImportResult,
} from '../placeStore'
import { useKey } from '../keystore'

// Through an extension, imports of more places than this ask first.
const EXTENSION_CONFIRM_ABOVE = 5

type Job = { label: string; done: number; total: number }

// Export, import and delete-all of your places (see placesFile.ts).
export function PlacesData() {
  const { status, places, loaded, opened } = usePlaces()
  const count = places.features.length
  const [job, setJob] = useState<Job | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { kind } = useKey()
  // An import waiting for the go-ahead, with how many places it will write.
  const [confirming, setConfirming] = useState<{
    count: number
    answer: (go: boolean) => void
  } | null>(null)
  // Set while an import runs, to cancel it.
  const [abort, setAbort] = useState<AbortController | null>(null)
  const busy = job !== null || status !== 'ready'

  const run = async (
    label: string,
    work: (progress: (d: number, t: number) => void) => Promise<string>,
  ) => {
    setMessage(null)
    setError(null)
    setJob({ label, done: 0, total: 0 })
    try {
      setMessage(
        await work((done, total) => setJob((j) => ({ label: j?.label ?? label, done, total }))),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setJob(null)
    }
  }

  const exportFile = () => {
    const file = exportPlaces()
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stede-places-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setError(null)
    setMessage(`Exported ${plural(file.places.length, 'place')}.`)
  }

  const importFile = (file: File) => {
    const controller = new AbortController()
    setAbort(controller)
    return run('Importing', async (progress) => {
      try {
        // An extension may ask before each place: say how many first, so it can
        // be set to allow stede for the import.
        const beforeWrite = (count: number) =>
          kind === 'extension' && count > EXTENSION_CONFIRM_ABOVE
            ? new Promise<boolean>((resolve) =>
                setConfirming({
                  count,
                  answer: (go) => {
                    setConfirming(null)
                    resolve(go)
                  },
                }),
              )
            : Promise.resolve(true)
        return summary(
          await importPlaces(await file.text(), progress, controller.signal, beforeWrite),
        )
      } finally {
        setAbort(null)
      }
    })
  }

  const deleteAll = () => {
    if (!window.confirm(`Delete all ${plural(count, 'place')}? This can’t be undone.`)) return
    void run(
      'Deleting',
      async (progress) => `Deleted ${plural(await deleteAllPlaces(progress), 'place')}.`,
    )
  }

  return (
    <div className="places-data">
      <h3>Your places</h3>
      <p className="key-note">
        {status === 'loading'
          ? opened > 0
            ? `Decrypting… ${opened.toLocaleString()} / ${plural(loaded, 'place')}`
            : `Loading… ${plural(loaded, 'place')}`
          : `${plural(count, 'place')} on the relay.`}{' '}
        The export file holds them unencrypted: keep it somewhere safe.
      </p>
      <div className="places-data-buttons">
        <button
          type="button"
          className="key-button"
          disabled={busy || count === 0}
          onClick={exportFile}
        >
          Export
        </button>
        <button
          type="button"
          className="key-button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
      </div>
      {confirming && (
        <div className="import-confirm" role="alertdialog" aria-label="Before importing">
          <p>
            This import will ask your Nostr extension to encrypt and sign{' '}
            {plural(confirming.count, 'place')}. If it asks you each time, set it to allow this site
            now, then continue.
          </p>
          <div className="places-data-buttons">
            <button type="button" className="key-button" onClick={() => confirming.answer(true)}>
              Continue
            </button>
            <button type="button" className="link-button" onClick={() => confirming.answer(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {job && !confirming && (
        <div className="progress" role="status">
          <progress
            value={job.total ? job.done : undefined}
            max={job.total || undefined}
            aria-label={job.label}
          />
          <span className="key-note">
            {job.label}…{' '}
            {job.total > 0 &&
              `${job.done.toLocaleString()} / ${job.total.toLocaleString()} (${Math.floor((100 * job.done) / job.total)}%)`}
          </span>
          {abort && (
            <button
              type="button"
              className="link-button"
              disabled={abort.signal.aborted}
              onClick={() => {
                abort.abort()
                setJob((j) => j && { ...j, label: 'Stopping' })
              }}
            >
              Cancel import
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="key-note" role="status">
          {message}
        </p>
      )}
      {error && <p className="key-error">{error}</p>}
      <button
        type="button"
        className="danger-button"
        disabled={busy || count === 0}
        onClick={deleteAll}
      >
        Delete all places
      </button>
    </div>
  )
}

function summary(r: ImportResult): string {
  if (r.cancelled && r.saved === 0) return 'Import cancelled: nothing was saved.'
  if (r.cancelled)
    return (
      `Import cancelled: ${r.saved.toLocaleString()} of ${plural(r.total, 'place')} saved. ` +
      'Import the same file again to add the rest.'
    )
  const parts = [
    `${plural(r.added, 'new place')}`,
    r.updated && `${r.updated.toLocaleString()} updated`,
    r.merged && `${plural(r.merged, 'duplicate')} merged`,
    r.unchanged && `${r.unchanged.toLocaleString()} already there`,
    r.invalid && `${r.invalid.toLocaleString()} invalid, skipped`,
    r.failed && `${r.failed.toLocaleString()} refused by the relay`,
  ].filter(Boolean)
  return `Imported: ${parts.join(', ')}.`
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}
