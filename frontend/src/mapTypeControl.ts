import type * as maplibregl from 'maplibre-gl'
import { MAP_TYPES, type MapType } from './mapStyle'

// A map control (under zoom and location) that switches the base map: a button
// opening a short list of the map types.
export class MapTypeControl implements maplibregl.IControl {
  private container?: HTMLElement
  private current: MapType
  private readonly onChange: (type: MapType) => void

  constructor(current: MapType, onChange: (type: MapType) => void) {
    this.current = current
    this.onChange = onChange
  }

  onAdd(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-type'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'map-type-button'
    button.title = 'Map type'
    button.setAttribute('aria-label', 'Map type')
    button.setAttribute('aria-expanded', 'false')
    button.innerHTML =
      '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 3 2.5 7 10 11l7.5-4L10 3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m2.5 10.5 7.5 4 7.5-4M2.5 14l7.5 4 7.5-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'

    const menu = document.createElement('div')
    menu.className = 'map-type-menu'
    menu.setAttribute('role', 'radiogroup')
    menu.setAttribute('aria-label', 'Map type')
    menu.hidden = true
    const options = MAP_TYPES.map((type) => {
      const option = document.createElement('button')
      option.type = 'button'
      option.setAttribute('role', 'radio')
      option.textContent = type.label
      option.addEventListener('click', () => {
        this.select(type, options)
        close()
      })
      menu.append(option)
      return { type, option }
    })
    this.select(this.current, options, false)

    const close = () => {
      menu.hidden = true
      button.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', onOutside)
    }
    const onOutside = (e: PointerEvent) => {
      if (!container.contains(e.target as Node)) close()
    }
    button.addEventListener('click', () => {
      if (!menu.hidden) return close()
      menu.hidden = false
      button.setAttribute('aria-expanded', 'true')
      document.addEventListener('pointerdown', onOutside)
    })
    container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        close()
        button.focus()
      }
    })

    container.append(button, menu)
    this.container = container
    return container
  }

  onRemove(): void {
    this.container?.remove()
  }

  private select(
    type: MapType,
    options: { type: MapType; option: HTMLButtonElement }[],
    notify = true,
  ) {
    for (const { type: t, option } of options)
      option.setAttribute('aria-checked', String(t === type))
    if (notify && type !== this.current) {
      this.current = type
      this.onChange(type)
    }
  }
}
