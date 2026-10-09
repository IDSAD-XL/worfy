// Settings → General: for now the build version (`app.version`). The interface scale slider comes
// with its own ticket.
import { useEffect, useState } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import { invoke } from '../ipc'
import { SettingRow } from './controls'

export const order = 10
export const title = 'General'

type Version = { kind: 'loading' } | { kind: 'ok'; version: string } | { kind: 'failed'; reason: string }

export default function GeneralSection() {
  const [version, setVersion] = useState<Version>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    void invoke('app.version').then((result) => {
      if (!live) return
      setVersion(result.ok ? { kind: 'ok', version: result.value.version } : { kind: 'failed', reason: failureReason('app.version', result.error) })
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <SettingRow label="Version" description="The build of worfy on this Machine." testId="settings-version-row">
      <span className="w-mono" style={{ fontSize: 'var(--text-12)', color: 'var(--text-secondary)' }} data-testid="settings-version" title={version.kind === 'failed' ? version.reason : undefined}>
        {version.kind === 'ok' ? version.version : version.kind === 'loading' ? '…' : 'unknown'}
      </span>
    </SettingRow>
  )
}
