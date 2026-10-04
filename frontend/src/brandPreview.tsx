// Dev-only page (/brand.html) to compare header brand colours.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrandPreview } from './components/BrandPreview'

const style = document.createElement('style')
style.textContent = `
  body { margin: 0; font: 14px system-ui, sans-serif; color: #2b241d; background: #faf7f1; }
  .brand-preview { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { margin: 0 0 6px; font-size: 22px; } h2 { margin: 28px 0 10px; font-size: 16px; }
  .intro { margin: 0 0 18px; color: #6e6352; }
  .row { display: grid; grid-template-columns: 220px 1fr; gap: 16px; align-items: center; margin-bottom: 10px; }
  .row-label { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  .row-label span { color: #6e6352; font-size: 12px; }
  .b-header { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px; background: #f5efe3; border: 1px solid #e2d8c4; border-radius: 8px; }
  .b-brand { display: flex; align-items: center; gap: 8px; }
  .b-name { font-family: 'Fondamento', Georgia, serif; font-size: 24px; line-height: 1; }
  .b-quote { margin-left: auto; font-family: 'Fondamento', Georgia, serif; font-style: italic; font-size: 14px; color: #6e6352; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .b-quote::before, .b-quote::after { color: #e5b320; }
  .b-add { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: #b8321f; }
`
document.head.append(style)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrandPreview />
  </StrictMode>,
)
