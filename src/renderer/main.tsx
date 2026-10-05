import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens first: every other stylesheet reads its variables.
import './theme/tokens.css'
import { AppShell } from './shell/AppShell'
import { invoke } from './ipc'

/** The app version from main (`app.version`); empty until it arrives or if the call fails. */
function AppVersion() {
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    let active = true
    void invoke('app.version').then((result) => {
      if (!active) return
      if (result.ok) setVersion(result.value.version)
      else console.error('app.version failed:', result.error)
    })
    return () => {
      active = false
    }
  }, [])
  return version ? <small data-testid="app-version">v{version}</small> : null
}

export function App() {
  // The Canvas view is empty until ticket 05; the version sits there as its placeholder content.
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
