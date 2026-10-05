import { useEffect, useState } from 'react'
import { invoke } from './ipc'

/**
 * The app version from main (`app.version`); empty until it arrives or if the call fails.
 * Mounted next to <App /> in main.tsx until the app shell (ticket 03) gives it a place of its own.
 */
export function AppVersion() {
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
