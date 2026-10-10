import { useCallback, useEffect, useState } from 'react'
import type { HarnessStatus as Status } from '../../../shared/ipc/harness'
import MigrationForm from '../../harness/MigrationForm'
import { invoke } from '../../ipc'

// The Harness in the toolbar (worfy-harness ticket 13): whether the plugin `worfy` of this build is
// installed, and the Install or Update button that opens main's consent dialog (src/main/ipc/harness.ts).
// After an error the button is Retry: the installer reads the state again and runs what is left,
// a missing dependency of the plugin included (ticket 30), so nothing is installed by hand.
// A dev run on the real ~/.claude shows the state without the button (canInstall).
// While the old Harness is still in ~/.claude, "Move old Harness…" opens the move form (ticket 14,
// src/renderer/harness/MigrationForm.tsx); the form itself says what is missing before a move.

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
  /** Opens the move form; the button shows only when given (main offers a move: harnessMigration.offer). */
  onMigrate?: (() => void) | undefined
}

/** The item for a given status; exported for tests. */
export function HarnessStatusView({ status, busy, failure, onInstall, onMigrate }: HarnessStatusViewProps) {
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
      button = action('Retry', 'Retry reads the state again and runs what is left of the install, a missing dependency of the plugin included; the dialog names every command before anything runs')
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
      {onMigrate === undefined ? null : (
        <button type="button" style={buttonStyle} onClick={onMigrate} title="Move the old Harness out of ~/.claude: the plugin worfy carries it now" data-testid="harness-migrate">
          Move old Harness…
        </button>
      )}
    </span>
  )
}

/** The Harness state from main (`harness.state`), and the install through `harness.install`. */
export default function HarnessStatus() {
  const [status, setStatus] = useState<Status>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [migration, setMigration] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const readOffer = useCallback(() => {
    void invoke('harnessMigration.offer').then((result) => {
      setMigration(result.ok && result.value.offered)
    })
  }, [])
  useEffect(readOffer, [readOffer])

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

  return (
    <>
      <HarnessStatusView status={status} busy={busy} failure={failure} onInstall={onInstall} onMigrate={migration ? () => setFormOpen(true) : undefined} />
      {formOpen ? (
        <MigrationForm
          onClose={() => {
            setFormOpen(false)
            readOffer()
          }}
          onMoved={readOffer}
        />
      ) : null}
    </>
  )
}
