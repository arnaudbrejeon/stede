import { tagColor, type TagColors } from '../tags'

type FilterPanelProps = {
  query: string
  onQueryChange: (query: string) => void
  tags: string[]
  selectedTags: ReadonlySet<string>
  onToggleTag: (tag: string) => void
  tagColors: TagColors
  shown: number
  total: number
}

export function FilterPanel({
  query,
  onQueryChange,
  tags,
  selectedTags,
  onToggleTag,
  tagColors,
  shown,
  total,
}: FilterPanelProps) {
  return (
    <div className="panel">
      <input
        type="search"
        placeholder="Filter by name"
        aria-label="Filter places by name"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <div className="chips" role="group" aria-label="Filter by tag">
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
      <p className="count">
        {shown} of {total} places
      </p>
    </div>
  )
}
