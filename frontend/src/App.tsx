import { useCallback, useMemo, useRef, useState } from 'react'
import { FilterPanel } from './components/FilterPanel'
import { Header } from './components/Header'
import { PlaceDrawer } from './components/PlaceDrawer'
import { PlacesMap } from './components/PlacesMap'
import { allTags, filterPlaces, SAMPLE_PLACES } from './places'
import { buildTagColors } from './tags'

function App() {
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const drawerRef = useRef<HTMLElement>(null)

  const tags = useMemo(() => allTags(SAMPLE_PLACES), [])
  const tagColors = useMemo(() => buildTagColors(tags), [tags])
  const filtered = useMemo(
    () => filterPlaces(SAMPLE_PLACES, query, selectedTags),
    [query, selectedTags],
  )
  // Looked up in the filtered set, so the drawer closes when filters hide the place.
  const selected = filtered.features.find((f) => f.properties.id === selectedId) ?? null
  const closeDrawer = useCallback(() => setSelectedId(null), [])

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (!next.delete(tag)) next.add(tag)
      return next
    })

  return (
    <div className={`app${selected ? ' drawer-open' : ''}`}>
      <Header />
      <main className="main">
        <PlacesMap
          places={filtered}
          selectedId={selected?.properties.id ?? null}
          onSelect={setSelectedId}
          tagColors={tagColors}
          overlayRef={drawerRef}
        />
        <FilterPanel
          query={query}
          onQueryChange={setQuery}
          tags={tags}
          selectedTags={selectedTags}
          onToggleTag={toggleTag}
          tagColors={tagColors}
          shown={filtered.features.length}
          total={SAMPLE_PLACES.features.length}
        />
        <PlaceDrawer
          ref={drawerRef}
          place={selected}
          onClose={closeDrawer}
          tagColors={tagColors}
        />
      </main>
    </div>
  )
}

export default App
