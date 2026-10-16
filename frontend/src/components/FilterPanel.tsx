import { useId, useState } from 'react'
import type { TagLine } from '../places'
import { tagColor, tagLabel, type TagColors } from '../tags'

// A folded line shows this many of its tags, then "+N".
const SUMMARY_TAGS = 3
// Where the panel starts folded into a button, as on phones (matches index.css).
const NARROW_SCREEN = '(max-width: 640px)'

type FilterPanelProps = {
  query: string
  onQueryChange: (query: string) => void
  tags: string[]
  // A place matches a line holding all its tags, and the filter if any line matches.
  tagLines: readonly TagLine[]
  onTagLinesChange: (lines: TagLine[]) => void
  tagColors: TagColors
}

export function FilterPanel({
  query,
  onQueryChange,
  tags,
  tagLines,
  onTagLinesChange,
  tagColors,
}: FilterPanelProps) {
  // At most one line is open, so a long tag list never stacks on another.
  // Lines start folded so the panel stays small over the map.
  const [openLine, setOpenLine] = useState<number | null>(null)
  // On phones the panel would cover much of the map, so it starts as a button.
  const [expanded, setExpanded] = useState(() => !window.matchMedia(NARROW_SCREEN).matches)
  const baseId = useId()
  const activeFilters = (query.trim() ? 1 : 0) + tagLines.filter((line) => line.size > 0).length

  const toggleTag = (index: number, tag: string) => {
    const line = new Set(tagLines[index])
    if (!line.delete(tag)) line.add(tag)
    onTagLinesChange(tagLines.map((l, i) => (i === index ? line : l)))
  }
  const addLine = () => {
    onTagLinesChange([...tagLines, new Set()])
    setOpenLine(tagLines.length)
  }
  // The last line is cleared rather than removed, so there's always one.
  const removeLine = (index: number) => {
    if (tagLines.length === 1) return onTagLinesChange([new Set()])
    onTagLinesChange(tagLines.filter((_, i) => i !== index))
    setOpenLine((open) => (open === null || open < index ? open : open === index ? null : open - 1))
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className="panel-toggle"
        aria-expanded={false}
        aria-label={activeFilters > 0 ? `Filters, ${activeFilters} active` : 'Filters'}
        onClick={() => setExpanded(true)}
      >
        <FilterIcon />
        Filter
        {activeFilters > 0 && <span className="panel-toggle-count">{activeFilters}</span>}
      </button>
    )
  }

  return (
    <div className="panel">
      <div className="panel-top">
        <input
          type="search"
          placeholder="Filter by name"
          aria-label="Filter places by name"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <button
          type="button"
          className="panel-fold"
          aria-expanded={true}
          aria-label="Hide filters"
          title="Hide filters"
          onClick={() => setExpanded(false)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3.5 10.5 8 6l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>
      {tagLines.map((line, index) => {
        const open = openLine === index
        const chipsId = `${baseId}-${index}`
        const selected = tags.filter((tag) => line.has(tag))
        const hidden = selected.length - SUMMARY_TAGS
        return (
          <div className="tag-line" key={index}>
            {index > 0 && <div className="tag-line-or">or</div>}
            <div className="tag-line-head">
              <button
                type="button"
                className="fold"
                aria-expanded={open}
                aria-controls={chipsId}
                onClick={() => setOpenLine(open ? null : index)}
              >
                <svg className="fold-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                {selected.length === 0 ? (
                  <>
                    Tags <span className="fold-note">· any</span>
                  </>
                ) : (
                  <span className="tag-summary">
                    {selected.slice(0, SUMMARY_TAGS).map((tag) => (
                      <span key={tag} className="chip chip-static">
                        <span className="swatch" style={{ background: tagColor(tagColors, tag) }} />
                        {tagLabel(tag)}
                      </span>
                    ))}
                    {hidden > 0 && <span className="fold-note">+{hidden}</span>}
                  </span>
                )}
              </button>
              {/* Nothing to clear on a lone empty line. */}
              {(selected.length > 0 || tagLines.length > 1) && (
                <button
                  type="button"
                  className="tag-line-remove"
                  aria-label={tagLines.length > 1 ? 'Remove this tag line' : 'Clear these tags'}
                  title={tagLines.length > 1 ? 'Remove this tag line' : 'Clear these tags'}
                  onClick={() => removeLine(index)}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
            <div className="chips" id={chipsId} role="group" aria-label="Filter by tag" hidden={!open}>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="chip"
                  aria-pressed={line.has(tag)}
                  onClick={() => toggleTag(index, tag)}
                >
                  <span className="swatch" style={{ background: tagColor(tagColors, tag) }} />
                  {tagLabel(tag)}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {/* Another line only helps once every line narrows something down. */}
      {tagLines.every((line) => line.size > 0) && (
        <button type="button" className="tag-line-add" onClick={addLine}>
          <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
            <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          Or other tags
        </button>
      )}
    </div>
  )
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2 3.5h12L9.5 8.8V13l-3-1.5V8.8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}
