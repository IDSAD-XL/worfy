import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens first: every other stylesheet reads its variables.
import './theme/tokens.css'
import { AppShell } from './shell/AppShell'
import { AppVersion } from './AppVersion'

export function App() {
  // The Canvas view stays empty until ticket 05 fills it; until then it shows the app version.
  return <AppShell canvas={<AppVersion />} />
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
