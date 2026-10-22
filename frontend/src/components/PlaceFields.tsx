import { useId, useState, type KeyboardEvent } from 'react'
import type { UserFields } from '../placeEvents'
import { placeIcon } from '../placeIconChoice'
import { ICON_CATEGORIES, PLACE_ICONS, type PlaceIcon, type PlaceIconKey } from '../placeIcons'
import {
  BEEN_THERE,
  DEFAULT_TAGS,
  sameLabel,
  STAR_TAGS,
  starsOf,
  tagColor,
  tagLabel,
  TO_TRY,
  withDefaultTag,
  type TagColors,
} from '../tags'

type PlaceFieldsProps = {
  value: UserFields
  onChange: (value: UserFields) => void
  // The place's OSM category, for the default icon.
  category?: string
  categoryKey?: string
  // The website found for the place, shown as a hint until you type your own.
  foundWebsite?: string | null
  // Labels already used on other places, offered as suggestions.
  allLabels: readonly string[]
  tagColors: TagColors
}

export function PlaceFields({
  value,
  onChange,
  category,
  categoryKey,
  foundWebsite,
  allLabels,
  tagColors,
}: PlaceFieldsProps) {
  const noteId = useId()
  const websiteId = useId()
  return (
    <div className="place-fields">
      <IconField
        icon={value.icon}
        defaultIcon={placeIcon(undefined, category, categoryKey)}
        onChange={(icon) => onChange({ ...value, icon })}
      />
      <LabelsField
        labels={value.labels}
        onChange={(labels) => onChange({ ...value, labels })}
        allLabels={allLabels}
        tagColors={tagColors}
      />
      <div className="field">
        <label htmlFor={websiteId}>Website</label>
        <input
          id={websiteId}
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value.website ?? ''}
          onChange={(e) => onChange({ ...value, website: e.target.value })}
          placeholder={foundWebsite ?? 'https://…'}
        />
      </div>
      <div className="field">
        <label htmlFor={noteId}>Comment</label>
        <textarea
          id={noteId}
          rows={3}
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          placeholder="What to remember about this place"
        />
      </div>
    </div>
  )
}

function IconField({
  icon,
  defaultIcon,
  onChange,
}: {
  icon: PlaceIconKey | undefined
  defaultIcon: PlaceIconKey
  onChange: (icon: PlaceIconKey | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const shown = icon ?? defaultIcon
  // Picking the category's own icon goes back to the default.
  const choose = (key: PlaceIconKey) => {
    onChange(key === defaultIcon ? undefined : key)
    setOpen(false)
  }
  return (
    <div className="field">
      <span className="field-label">Icon</span>
      <button
        type="button"
        className="icon-current"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Glyph icon={PLACE_ICONS[shown]} size={24} />
        <span>{icon ? PLACE_ICONS[icon].label : `${PLACE_ICONS[defaultIcon].label} (default)`}</span>
        <span className="icon-change">{open ? 'Close' : 'Change'}</span>
      </button>
      {open && (
        <div className="icon-picker">
          {ICON_CATEGORIES.flatMap((c) => c.icons).map((key) => (
            <button
              key={key}
              type="button"
              className="icon-choice"
              aria-pressed={shown === key}
              aria-label={PLACE_ICONS[key].label}
              title={PLACE_ICONS[key].label}
              onClick={() => choose(key)}
            >
              <Glyph icon={PLACE_ICONS[key]} size={28} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function LabelsField({
  labels,
  onChange,
  allLabels,
  tagColors,
}: {
  labels: string[]
  onChange: (labels: string[]) => void
  allLabels: readonly string[]
  tagColors: TagColors
}) {
  const [text, setText] = useState('')
  const inputId = useId()
  const stars = starsOf(labels)
  const toggle = (label: string) =>
    onChange(labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label])
  // Built-in labels keep their rules (see withDefaultTag).
  const setDefault = (tag: string) => onChange(withDefaultTag(labels, tag, !labels.includes(tag)))
  // Kept as typed; a label you already have (in any case) is reused.
  const create = () => {
    const typed = text.trim()
    setText('')
    if (!typed) return
    const label = [...DEFAULT_TAGS, ...allLabels].find((l) => sameLabel(l, typed)) ?? typed
    if (labels.some((l) => sameLabel(l, label))) return
    onChange(DEFAULT_TAGS.includes(label) ? withDefaultTag(labels, label, true) : [...labels, label])
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      create()
    }
  }
  // Your other labels, with the ones on this place first so they're easy to remove.
  const others = [...new Set([...labels, ...allLabels])].filter((l) => !DEFAULT_TAGS.includes(l))

  const chip = (label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      className="label-toggle"
      aria-pressed={labels.includes(label)}
      onClick={onClick}
    >
      <span className="swatch" style={{ background: tagColor(tagColors, label) }} />
      {tagLabel(label)}
    </button>
  )

  return (
    <div className="field">
      <span className="field-label">Labels</span>
      <div className="label-toggles">
        {chip(TO_TRY, () => setDefault(TO_TRY))}
        {chip(BEEN_THERE, () => setDefault(BEEN_THERE))}
        <span className="stars" role="group" aria-label="Rating">
          {STAR_TAGS.map((tag, i) => (
            <button
              key={tag}
              type="button"
              className={`star${i < stars ? ' on' : ''}`}
              aria-pressed={stars === i + 1}
              aria-label={tag}
              title={tag}
              onClick={() => setDefault(tag)}
            >
              ★
            </button>
          ))}
        </span>
      </div>
      {others.length > 0 && (
        <div className="label-toggles">{others.map((label) => chip(label, () => toggle(label)))}</div>
      )}
      <input
        id={inputId}
        className="label-new"
        aria-label="New label"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={create}
        placeholder="New label"
        autoCapitalize="off"
      />
    </div>
  )
}

export function Glyph({ icon, size }: { icon: PlaceIcon; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {icon.fill.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
      {icon.holes.map((d, i) => (
        <path key={`h${i}`} d={d} className="glyph-hole" />
      ))}
    </svg>
  )
}
