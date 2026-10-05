import { useEffect, useState } from 'react'
import { invoke } from './ipc'

/**
 * The app version from main (`app.version`); empty until it arrives or if the call fails.
 * main.tsx puts it in the Canvas slot of AppShell (ticket 03) while the Canvas view is empty (ticket 05).
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
