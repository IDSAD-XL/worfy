import { useEffect, useState } from 'react'
import type { HarnessStatus as Status } from '../../../shared/ipc/harness'
import { invoke } from '../../ipc'

// The Harness in the toolbar (worfy-harness ticket 13): whether the plugin `worfy` of this build is
// installed, and the Install or Update button that opens main's consent dialog (src/main/ipc/harness.ts).
// A dev run on the real ~/.claude shows the state without the button (canInstall).

// After the Limits (100), before the app version (1000).
export const order = 500

const textStyle = { fontSize: 'var(--text-11)', color: 'var(--text-muted)', whiteSpace: 'nowrap' } as const
const buttonStyle = {
  height: 22,
  padding: '0 8px',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-button)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 'var(--text-11)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
} as const

export interface HarnessStatusViewProps {
  status: Status | undefined
  busy: boolean
  /** The last call that failed, shown instead of the state. */
  failure: string | undefined
  onInstall: () => void
}

/** The item for a given status; exported for tests. */
export function HarnessStatusView({ status, busy, failure, onInstall }: HarnessStatusViewProps) {
  if (failure !== undefined) {
    return (
      <span style={{ ...textStyle, color: 'var(--blocked-text)' }} title={failure} data-testid="harness-status">
        Harness unavailable
      </span>
    )
  }
  if (status === undefined) return null
  if (busy) {
    return (
      <span style={textStyle} data-testid="harness-status">
        Installing Harness…
      </span>
    )
  }
  const { state, canInstall } = status
  const action = (label: string, title?: string) =>
    canInstall ? (
      <button type="button" style={buttonStyle} onClick={onInstall} title={title} data-testid="harness-action">
        {label}
      </button>
    ) : null

  let text: string
  let title: string | undefined
  let tone: string = 'var(--text-muted)'
  let button: ReturnType<typeof action> = null
  switch (state.kind) {
    case 'not-installed':
      text = 'Harness not installed'
      button = action('Install', `Install the Harness ${status.bundledVersion ?? ''} into ${status.pluginDir}`)
      break
    case 'installed':
      text = state.enabled ? `Harness ${state.version}` : `Harness ${state.version} · disabled`
      title = state.enabled ? undefined : 'The plugin worfy is disabled in Claude Code'
      break
    case 'outdated':
      text = canInstall ? '' : `Harness ${state.from ?? '?'} → ${state.to}`
      button = action('Update Harness', `${state.from ?? 'unknown'} → ${state.to}`)
      break
    case 'error':
      text = `Harness error: ${state.step}`
      title = state.reason
      tone = 'var(--blocked-text)'
      button = action('Retry', 'Fix what the error names first (a missing dependency: install it with claude plugin install), then Retry: it reads the state again and runs what is left of the install')
      break
  }
  return (
    <span role="group" aria-label="Harness" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none' }} data-testid="harness-status" data-state={state.kind}>
      {text === '' ? null : (
        <span style={{ ...textStyle, color: tone }} title={title} data-testid="harness-text">
          {text}
        </span>
      )}
      {button}
    </span>
  )
}

/** The Harness state from main (`harness.state`), and the install through `harness.install`. */
export default function HarnessStatus() {
  const [status, setStatus] = useState<Status>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()

  useEffect(() => {
    let active = true
    void invoke('harness.state').then((result) => {
      if (!active) return
      if (result.ok) setStatus(result.value)
      else setFailure(result.error)
    })
    return () => {
      active = false
    }
  }, [])

  const onInstall = (): void => {
    setBusy(true)
    void invoke('harness.install').then((result) => {
      setBusy(false)
      if (result.ok) {
        setFailure(undefined)
        setStatus(result.value.status)
      } else setFailure(result.error)
    })
  }

  return <HarnessStatusView status={status} busy={busy} failure={failure} onInstall={onInstall} />
}
