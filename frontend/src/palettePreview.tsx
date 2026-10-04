// Dev-only page (/palette.html) to review the proposed colour palette.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PalettePreview } from './components/PalettePreview'

const style = document.createElement('style')
style.textContent = `
  body { margin: 0; font: 14px system-ui, sans-serif; color: #2b241d; background: #faf7f1; }
  .palette-preview { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { margin: 0 0 6px; font-family: 'Fondamento', Georgia, serif; font-weight: 400; font-size: 32px; }
  h2 { margin: 32px 0 12px; font-size: 16px; }
  .intro { margin: 0 0 12px; color: #6e6352; max-width: 70ch; }
  .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .swatch-card { margin: 0; display: flex; gap: 12px; align-items: center; }
  .swatch-card .chip { flex: none; width: 56px; height: 56px; border-radius: 10px; border: 1px solid rgba(0,0,0,0.08); }
  .swatch-card figcaption { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  .swatch-card span { color: #6e6352; }
  code { font-size: 12px; color: #6e6352; }
  .side-by-side { display: grid; grid-template-columns: repeat(auto-fit, minmax(520px, 1fr)); gap: 20px; }
  .mock-wrap { margin: 0; }
  .mock-wrap > figcaption { font-size: 13px; color: #6e6352; margin-bottom: 6px; }
  .tag-rows { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
  .tag-row { display: flex; align-items: center; gap: 8px; }
  .tag-row-label { width: 80px; color: #6e6352; font-size: 13px; }
  .tag-dot { width: 34px; height: 34px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1px #e2d8c4; }
  .pigment-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px 16px; font-size: 13px; }
  .pigment-list span { display: flex; align-items: center; gap: 6px; }
  .pigment-list i { display: inline-block; width: 14px; height: 14px; border-radius: 50%; }
  .side-by-side.maps { grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
  .fresh-alt { display: flex; align-items: center; gap: 5px; }
  .fresh-alt i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
  .palette-preview { max-width: 1680px; }
  .live-map { height: 420px; border-radius: 10px; overflow: hidden; border: 1px solid #e2d8c4; }

  .mock { border: 1px solid #d9d0bf; border-radius: 10px; overflow: hidden; color: var(--ink); font-size: 13px; }
  .m-header { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 12px; background: var(--bg); border-bottom: 1px solid var(--line); }
  .m-logo { color: var(--ink); display: flex; }
  .m-name { font-family: 'Fondamento', Georgia, serif; font-size: 21px; }
  .m-quote { margin-left: auto; font-family: 'Fondamento', Georgia, serif; font-style: italic; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; padding-left: 12px; }
  .m-gold { color: var(--gold); }
  .m-body { position: relative; height: 330px; background: var(--map); }
  .m-panel { position: absolute; top: 10px; left: 10px; width: 210px; padding: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
  .m-input { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); background: var(--surface); }
  .m-focused { outline: 2px solid var(--accent); outline-offset: 1px; }
  .m-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .m-chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; background: var(--surface); }
  .m-chip i { width: 8px; height: 8px; border-radius: 50%; }
  .m-selected { background: var(--ink); color: var(--surface); border-color: var(--ink); }
  .m-selected i { box-shadow: 0 0 0 1.5px var(--surface); }
  .m-muted { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
  .m-pins { position: absolute; left: 24px; top: 170px; display: flex; gap: 22px; }
  .m-add { position: absolute; right: 244px; bottom: 14px; padding: 7px 12px; border: 0; border-radius: 999px; font: inherit; font-weight: 600; color: var(--surface); background: var(--ink); }
  .m-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 200px; padding: 10px 14px; background: var(--surface); border-left: 1px solid var(--line); }
  .m-drawer h3 { margin: 8px 0 2px; font-size: 16px; }
  .m-drawer dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 10px 0 0; font-size: 12px; }
  .m-drawer dt { color: var(--muted); }
  .m-drawer dd { margin: 0; }
  .m-link { color: var(--link); font-size: 12px; }
  .m-underline { text-decoration: underline; }
`
document.head.append(style)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PalettePreview />
  </StrictMode>,
)
