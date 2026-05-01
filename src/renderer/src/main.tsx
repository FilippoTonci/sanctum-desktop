import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/fraunces/700.css'
import '@fontsource/fraunces/400-italic.css'
import '@fontsource/ibm-plex-sans/300.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/400-italic.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import { App } from './App'
import './index.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('Root container not found')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
