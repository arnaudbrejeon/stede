// Dev-only page (/icons.html) to review the place icon set at real pin size.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IconPreview } from './components/IconPreview'

const style = document.createElement('style')
style.textContent = `
  body { margin: 0; font: 14px system-ui, sans-serif; color: #1d2733; background: #fafaf8; }
  .icon-preview { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { margin: 0 0 4px; } p { color: #5d6b7a; margin: 0 0 24px; }
  section { border-top: 1px solid #dde3ea; padding: 14px 0; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  .variants { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; }
  figure { margin: 0; }
  figcaption { font-size: 13px; color: #5d6b7a; margin-bottom: 6px; }
  .samples { display: flex; align-items: center; gap: 18px; }
  .map-bg { display: flex; gap: 10px; padding: 10px; border-radius: 8px; background: #ece8e1; }
  .designs .variants { display: block; }
  .designs figure { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-bottom: 12px; }
  .designs figcaption { width: 72px; margin: 0; font-family: ui-monospace, monospace; }
  .designs .map-bg { align-items: center; }
`
document.head.append(style)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconPreview />
  </StrictMode>,
)
