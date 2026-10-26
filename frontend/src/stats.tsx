import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './relayStats.css'
import { RelayStats } from './components/RelayStats'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RelayStats />
  </StrictMode>,
)
