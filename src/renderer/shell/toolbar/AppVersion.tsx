import { useEffect, useState } from 'react'
import { invoke } from '../../ipc'

// After every other toolbar item, just before the command palette hint.
export const order = 1000

/** The app version from main (`app.version`); empty until it arrives or if the call fails. */
export default function AppVersion() {
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
  return version ? (
    <small className="w-mono" style={{ fontSize: 'var(--text-11)', color: 'var(--text-muted)' }} data-testid="app-version">
      v{version}
    </small>
  ) : null
}
