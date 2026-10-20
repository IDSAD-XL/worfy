import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { HarnessStatus as Status } from '../../../shared/ipc/harness'
import MigrationForm from '../../harness/MigrationForm'
import AppMemory from '../../memory/AppMemory'
import { invoke } from '../../ipc'

// The Harness in the toolbar (worfy-harness ticket 13): whether the plugin `worfy` of this build is
// installed, and the Install or Update button that opens main's consent dialog (src/main/ipc/harness.ts).
// After an error the button is Retry: the installer reads the state again and runs what is left,
// a missing dependency of the plugin included (ticket 30), so nothing is installed by hand.
// A dev run on the real ~/.claude shows the state without the button (canInstall).
// While the old Harness is still in ~/.claude, "Move old Harness…" opens the move form (ticket 14,
// src/renderer/harness/MigrationForm.tsx); the form itself says what is missing before a move.

// The app version (`app.version`) is the second line of this item, small and muted under the
// Harness line (worfy-ui ticket 18): one column, so the toolbar's height stays the same.
// worfy's own memory follows the version on that line (worfy-ui ticket 20, src/renderer/memory/AppMemory.tsx):
// both describe the running app, and the line is shorter than the Harness line above it.
// The actions are icon buttons with a native tooltip and an aria-label: Install, Update Harness,
// Retry and "Move old Harness…".

// After the Limits (100), last of the toolbar items.
export const order = 500

const textStyle = { fontSize: 'var(--text-11)', lineHeight: '20px', color: 'var(--text-muted)', whiteSpace: 'nowrap' } as const
const versionStyle = { fontSize: 'var(--text-11)', lineHeight: '13px', color: 'var(--text-muted)', opacity: 0.8, whiteSpace: 'nowrap' } as const

const iconProps = { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

const ICONS = {
  /** An arrow down onto a line. */
  install: (
    <svg {...iconProps}>
      <path d="M8 2.5v8M5 7.5l3 3 3-3M3 13.5h10" />
    </svg>
  ),
  /** An arrow up in a circle. */
  update: (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 11V5M5.5 7.5 8 5l2.5 2.5" />
    </svg>
  ),
  /** A circular arrow. */
  retry: (
    <svg {...iconProps}>
      <path d="M13 8a5 5 0 1 1-1.46-3.54" />
      <path d="M13 2.5v3h-3" />
    </svg>
  ),
  /** A box with an arrow out of it. */
  migrate: (
    <svg {...iconProps}>
      <path d="M2.5 6.5v7h11v-7M8 10V2.5M5.5 5 8 2.5 10.5 5" />
    </svg>
  ),
}

interface IconButtonProps {
  icon: keyof typeof ICONS
  /** The accessible name. */
  label: string
  /** The native tooltip; the label when omitted. */
  title?: string
  onClick: () => void
  testId: string
}

function IconButton({ icon, label, title, onClick, testId }: IconButtonProps) {
  return (
    <button type="button" className="w-toolbar__icon-button w-toolbar__icon-button--compact" aria-label={label} title={title ?? label} onClick={onClick} data-testid={testId}>
      {ICONS[icon]}
    </button>
  )
}

export interface HarnessStatusViewProps {
  status: Status | undefined
  busy: boolean
  /** The last call that failed, shown instead of the state. */
  failure: string | undefined
  onInstall: () => void
  /** Opens the move form; the button shows only when given (main offers a move: harnessMigration.offer). */
  onMigrate?: (() => void) | undefined
  /** The app version, the second line; nothing until it arrives. */
  version?: string | undefined
  /** worfy's own memory, after the version on the second line. */
  memory?: ReactNode
}

/** The item for a given status: the Harness line, and the app version under it; exported for tests. */
export function HarnessStatusView({ version, memory, ...props }: HarnessStatusViewProps) {
  const harness = <HarnessLine {...props} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', flex: 'none' }} data-testid="harness-column">
      {harness}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }} data-testid="app-line">
        {version ? (
          <small className="w-mono" style={versionStyle} data-testid="app-version">
            v{version}
          </small>
        ) : null}
        {memory}
      </div>
    </div>
  )
}

function HarnessLine({ status, busy, failure, onInstall, onMigrate }: Omit<HarnessStatusViewProps, 'version'>) {
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
  const action = (icon: IconButtonProps['icon'], label: string, title: string) =>
    canInstall ? <IconButton icon={icon} label={label} title={title} onClick={onInstall} testId="harness-action" /> : null

  let text: string
  let title: string | undefined
  let tone: string = 'var(--text-muted)'
  let button: ReturnType<typeof action> = null
  switch (state.kind) {
    case 'not-installed':
      text = 'Harness not installed'
      button = action('install', 'Install', `Install the Harness ${status.bundledVersion ?? ''} into ${status.pluginDir}`)
      break
    case 'installed':
      text = state.enabled ? `Harness ${state.version}` : `Harness ${state.version} · disabled`
      title = state.enabled ? undefined : 'The plugin worfy is disabled in Claude Code'
      break
    case 'outdated':
      // With the update offered the line names the installed version and the icon the new one.
      text = canInstall ? `Harness ${state.from ?? '?'}` : `Harness ${state.from ?? '?'} → ${state.to}`
      button = action('update', 'Update Harness', `Update Harness: ${state.from ?? 'unknown'} → ${state.to}`)
      break
    case 'error':
      text = `Harness error: ${state.step}`
      title = state.reason
      tone = 'var(--blocked-text)'
      button = action('retry', 'Retry', 'Retry reads the state again and runs what is left of the install, a missing dependency of the plugin included; the dialog names every command before anything runs')
      break
  }
  return (
    <span role="group" aria-label="Harness" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: 'none' }} data-testid="harness-status" data-state={state.kind}>
      <span style={{ ...textStyle, color: tone }} title={title} data-testid="harness-text">
        {text}
      </span>
      {button}
      {onMigrate === undefined ? null : <IconButton icon="migrate" label="Move old Harness…" onClick={onMigrate} testId="harness-migrate" />}
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
      <HarnessStatusView status={status} busy={busy} failure={failure} onInstall={onInstall} onMigrate={migration ? () => setFormOpen(true) : undefined} version={version} memory={<AppMemory />} />
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
