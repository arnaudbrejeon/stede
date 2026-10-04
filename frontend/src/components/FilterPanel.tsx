import { useId, useState } from 'react'
import { tagColor, type TagColors } from '../tags'

type FilterPanelProps = {
  query: string
  onQueryChange: (query: string) => void
  tags: string[]
  selectedTags: ReadonlySet<string>
  onToggleTag: (tag: string) => void
  tagColors: TagColors
}

export function FilterPanel({
  query,
  onQueryChange,
  tags,
  selectedTags,
  onToggleTag,
  tagColors,
}: FilterPanelProps) {
  // Tags start folded so the panel stays small over the map.
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsId = useId()

  return (
    <div className="panel">
      <input
        type="search"
        placeholder="Filter by name"
        aria-label="Filter places by name"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <button
        type="button"
        className="fold"
        aria-expanded={tagsOpen}
        aria-controls={tagsId}
        onClick={() => setTagsOpen((open) => !open)}
      >
        <svg className="fold-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        Tags
        {selectedTags.size > 0 && <span className="fold-note">· {selectedTags.size} selected</span>}
      </button>
      <div className="chips" id={tagsId} role="group" aria-label="Filter by tag" hidden={!tagsOpen}>
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="chip"
            aria-pressed={selectedTags.has(tag)}
            onClick={() => onToggleTag(tag)}
          >
            <span className="swatch" style={{ background: tagColor(tagColors, tag) }} />
            {tag}
          </button>
        ))}
      </div>
    </div>
  )
}
