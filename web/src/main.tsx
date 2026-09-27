import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/golos-text/400.css'
import '@fontsource/golos-text/500.css'
import '@fontsource/golos-text/600.css'
import '@fontsource/golos-text/700.css'
import '@gravity-ui/uikit/styles/styles.css'
import './index.css'

import App from './App'
import { startRouter } from './lib/router'

startRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) Object.assign(window, { tf: (await import('./store')).useStore, tfSim: (await import('./simState')).useSim, tfXlsx: (await import('./xlsx')).workbook })
