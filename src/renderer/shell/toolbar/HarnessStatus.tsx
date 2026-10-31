import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { HarnessStatus as Status } from '../../../shared/ipc/harness'
import type { UpdateSnapshot } from '../../../shared/ipc/update'
import MigrationForm from '../../harness/MigrationForm'
import AppMemory from '../../memory/AppMemory'
import { invoke, subscribe } from '../../ipc'
import { useUpdate } from '../../update/store'
import UpdateChip from '../../update/UpdateChip'

// The Harness in the toolbar (worfy-harness ticket 13): whether the plugin `worfy` of this build is
// installed, and the Install or Update button that opens main's consent dialog (src/main/ipc/harness.ts).
// After an error the button is Retry: the installer reads the state again and runs what is left,
// a missing dependency of the plugin included (ticket 30), so nothing is installed by hand.
// A dev run on the real ~/.claude shows the state without the button (canInstall).
// While the old Harness is still in ~/.claude, "Move old Harness…" opens the move form (ticket 14,
// src/renderer/harness/MigrationForm.tsx); the form itself says what is missing before a move.
// The item reads `harness.state` and `harnessMigration.offer` once, then follows main's
// `harness.changed` and `harnessMigration.changed` (ticket 40): an install or a move started from the
// first-run screen or from another window shows here without a reload. During its own install the
// item stays on "Installing Harness…" until its own answer, whatever arrives meanwhile.

// The app version (`app.version`) is the second line of this item, small and muted under the
// Harness line (worfy-ui ticket 18): one column, so the toolbar's height stays the same.
// worfy's own memory follows the version on that line (worfy-ui ticket 20, src/renderer/memory/AppMemory.tsx):
// both describe the running app, and the line is shorter than the Harness line above it.
// The actions are icon buttons with a native tooltip and an aria-label: Install, Update Harness,
// Retry and "Move old Harness…".
//
// worfy-update ticket 06: the version is the version chip (src/renderer/update/UpdateChip.tsx), a button with a dot
// and a menu while an Update of worfy waits. A Harness to update is the same kind of signal: an
// outdated Harness of an older semver, or one of the same semver that main found behind this copy
// (`harnessBehind` of the Update snapshot, ticket 05), gets the accent and a dot on its "Update
// Harness" button. A Harness of the same semver main could not order stays "Replace Harness", plain.

// After the Limits (100), last of the toolbar items.
export const order = 500

const textStyle = { fontSize: 'var(--text-11)', lineHeight: '20px', color: 'var(--text-muted)', whiteSpace: 'nowrap' } as const

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
  /** A signal: the accent and a dot (worfy-update ticket 06). */
  accent?: boolean
}

function IconButton({ icon, label, title, onClick, testId, accent = false }: IconButtonProps) {
  const className = `w-toolbar__icon-button w-toolbar__icon-button--compact${accent ? ' w-toolbar__icon-button--accent' : ''}`
  return (
    <button type="button" className={className} aria-label={label} title={title ?? label} onClick={onClick} data-testid={testId}>
      {ICONS[icon]}
      {accent ? <span className="w-update-dot" aria-hidden="true" /> : null}
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
  /** Main's Update snapshot for the version chip; null or absent: the plain version line. */
  update?: UpdateSnapshot | null
  /** The installed Harness of the same semver is behind this copy's (the Update snapshot's `harnessBehind`). */
  harnessBehind?: UpdateSnapshot['harnessBehind'] | undefined
}

/** The item for a given status: the Harness line, and the app version under it; exported for tests. */
export function HarnessStatusView({ version, memory, update = null, ...props }: HarnessStatusViewProps) {
  const harness = <HarnessLine {...props} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', flex: 'none' }} data-testid="harness-column">
      {harness}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }} data-testid="app-line">
        {version ? <UpdateChip version={version} update={update} /> : null}
        {memory}
      </div>
    </div>
  )
}

function HarnessLine({ status, busy, failure, onInstall, onMigrate, harnessBehind = null }: Omit<HarnessStatusViewProps, 'version' | 'update'>) {
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
  const action = (icon: IconButtonProps['icon'], label: string, title: string, accent = false) =>
    canInstall ? <IconButton icon={icon} label={label} title={title} onClick={onInstall} testId="harness-action" accent={accent} /> : null

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
      if (state.sameVersion && harnessBehind !== null && harnessBehind.from === state.from) {
        // Main found the installed commit behind this copy's (worfy-update ticket 05): an update, as for an older semver.
        // Only for the version this state names as installed: a snapshot about another one is stale.
        text = canInstall ? `Harness ${harnessBehind.from}` : `Harness ${harnessBehind.from} → ${harnessBehind.to}`
        button = action('update', 'Update Harness', `Update Harness: ${harnessBehind.from} → ${harnessBehind.to}`, true)
        break
      }
      if (state.sameVersion) {
        // The same semver from another commit (worfy-harness ticket 67): no arrow, as worfy cannot tell which one is newer.
        text = canInstall ? `Harness ${state.from ?? '?'}` : `Harness ${state.from ?? '?'}, this build ${state.to}`
        button = action('update', 'Replace Harness', `Replace Harness ${state.from ?? 'unknown'} with ${state.to}: the same version from another commit, and worfy cannot tell which one is newer`)
        break
      }
      // With the update offered the line names the installed version and the icon the new one.
      text = canInstall ? `Harness ${state.from ?? '?'}` : `Harness ${state.from ?? '?'} → ${state.to}`
      button = action('update', 'Update Harness', `Update Harness: ${state.from ?? 'unknown'} → ${state.to}`, true)
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

/**
 * The Harness state from main (`harness.state`, then `harness.changed`), and the install through
 * `harness.install`. Settings → Pipeline shows it too, when the Harness is too old for the editor;
 * worfy's memory stands only in the toolbar (`memory`, given by the toolbar item below).
 */
export function HarnessStatus({ memory = false }: { memory?: boolean }) {
  const [status, setStatus] = useState<Status>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [migration, setMigration] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [version, setVersion] = useState<string>()
  const update = useUpdate()

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

  // How many `harnessMigration.changed` events arrived: an offer answer to a call made before the
  // latest event is older than that event and is dropped, as the first `harness.state` answer is.
  const offerEvents = useRef(0)
  const readOffer = useCallback(() => {
    const asked = offerEvents.current
    void invoke('harnessMigration.offer').then((result) => {
      if (offerEvents.current !== asked) return
      setMigration(result.ok && result.value.offered)
    })
  }, [])
  useEffect(readOffer, [readOffer])

  useEffect(() => {
    let active = true
    // An event that arrives before the first answer is newer than that answer: the answer is dropped.
    let heard = false
    void invoke('harness.state').then((result) => {
      if (!active || heard) return
      if (result.ok) setStatus(result.value)
      else setFailure(result.error)
    })
    // No bridge, or one without events (the preload did not run): the item shows what the first
    // answers say rather than taking the toolbar down, as the other views do.
    let stopState = (): void => undefined
    try {
      stopState = subscribe('harness.changed', (next) => {
        heard = true
        setFailure(undefined)
        setStatus(next)
      })
    } catch (error) {
      console.error('harness.changed: cannot subscribe', error)
    }
    let stopOffer = (): void => undefined
    try {
      stopOffer = subscribe('harnessMigration.changed', (next) => {
        offerEvents.current++
        setMigration(next.offered)
      })
    } catch (error) {
      console.error('harnessMigration.changed: cannot subscribe', error)
    }
    return () => {
      active = false
      stopState()
      stopOffer()
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
      <HarnessStatusView
        status={status}
        busy={busy}
        failure={failure}
        onInstall={onInstall}
        onMigrate={migration ? () => setFormOpen(true) : undefined}
        version={version}
        memory={memory ? <AppMemory /> : undefined}
        update={update}
        harnessBehind={update?.enabled ? update.harnessBehind : null}
      />
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

/** The toolbar item: the Harness column with worfy's memory after the app version. */
export default function HarnessStatusItem() {
  return <HarnessStatus memory />
}
