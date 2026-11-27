import type { ReactNode } from 'react'
import type { HarnessStatus as Status } from '../../shared/ipc/harness'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { Tooltip } from '../theme/kit/Tooltip'
import { codexPartOf, harnessPart, type IconName } from './harness-lines'
import { useHarnessStatus } from './useHarnessStatus'

// The Harness state (worfy-harness ticket 13): whether the plugin `worfy` of this build is installed,
// and the Install or Update button that opens main's consent dialog (src/main/ipc/harness.ts).
// After an error the button is Retry: the installer reads the state again and runs what is left,
// a missing dependency of the plugin included (ticket 30), so nothing is installed by hand.
// A dev run on the real ~/.claude shows the state without the button (canInstall).
// While the old Harness is still in ~/.claude, "Move old Harness…" opens the move form (ticket 14,
// src/renderer/harness/MigrationForm.tsx); the form itself says what is missing before a move.
// The state reads `harness.state` and `harnessMigration.offer` once, then follows main's
// `harness.changed` and `harnessMigration.changed` (ticket 40): an install or a move started from the
// first-run screen or from another window shows here without a reload. During its own install the
// line stays on "Installing Harness…" until its own answer, whatever arrives meanwhile.
// worfy-multi-vendor ticket 39: an install or update in Codex that leaves the Harness hooks to approve
// opens the step "Approve the Harness hooks in Codex" (src/renderer/harness/CodexHooksStep.tsx), and
// "Codex: approve hooks" on the Codex line opens it again (worfy-polish ticket 93: its own line, with its
// own button — Install in Codex, Update Harness in Codex, Retry).
// The actions are icon buttons with a tooltip and an aria-label: Install, Update Harness,
// Retry and "Move old Harness…" — a plain list after the line's text, so one more fits.
//
// worfy-update ticket 06: a Harness to update is a signal, as an Update of worfy is: an outdated
// Harness of an older semver, or one of the same semver that main found behind this copy
// (`harnessBehind` of the Update snapshot, ticket 05), gets the accent and a dot on its "Update
// Harness" button. A Harness of the same semver main could not order stays "Replace Harness", plain.
//
// worfy-layout ticket 03: the Harness left the toolbar. Its lines are rows of the version chip's popover
// in the footer (src/renderer/shell/footer/VersionChip.tsx), and the chip — mounted for the life of the
// window — holds the state through `useHarnessStatus` (useHarnessStatus.tsx), so the Codex hooks step still opens by itself
// while the popover is closed. Settings → Pipeline shows the lines too (`HarnessStatus` below).

// The lines give way where their place is narrow: each text ends with an ellipsis, and the Harness
// line keeps its whole text as its tooltip (worfy-polish ticket 48).
const textStyle = { fontSize: 'var(--text-11)', lineHeight: '20px', color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' } as const

const iconProps = { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

const ICONS: Record<IconName, ReactNode> = {
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
  icon: IconName
  /** The accessible name. */
  label: string
  /** The tooltip (Tooltip kit); the label when omitted. */
  title?: string
  onClick: () => void
  testId: string
  /** A signal: the accent and a dot (worfy-update ticket 06). */
  accent?: boolean
}

function IconButton({ icon, label, title, onClick, testId, accent = false }: IconButtonProps) {
  const className = `w-toolbar__icon-button w-toolbar__icon-button--compact${accent ? ' w-toolbar__icon-button--accent' : ''}`
  return (
    <Tooltip label={title ?? label}>
      <button type="button" className={className} aria-label={label} onClick={onClick} data-testid={testId}>
        {ICONS[icon]}
        {accent ? <span className="w-update-dot" aria-hidden="true" /> : null}
      </button>
    </Tooltip>
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
  /**
   * Opens the step "Approve the Harness hooks in Codex" (worfy-multi-vendor ticket 39): with it, the
   * Codex part's "Codex: approve hooks" is a button.
   */
  onApproveHooks?: (() => void) | undefined
  /** The installed Harness of the same semver is behind this copy's (the Update snapshot's `harnessBehind`). */
  harnessBehind?: UpdateSnapshot['harnessBehind'] | undefined
}

/** The Harness line and, under it, the Codex line: what Settings → Pipeline shows; exported for tests. */
export function HarnessStatusView(props: HarnessStatusViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }} data-testid="harness-lines">
      <HarnessLine {...props} />
      <CodexLine {...props} />
    </div>
  )
}

/** The Codex line is 16 px high. */
const codexLineText = { lineHeight: '16px' } as const

/** The Codex line: the Codex part with its button (worfy-polish ticket 93), while there is one. */
export function CodexLine({ status, busy, failure, onInstall, onApproveHooks }: HarnessStatusViewProps) {
  const codex = codexPartOf({ status, busy, failure })
  if (codex === null || status === undefined) return null
  const button = codex.button !== undefined && status.canInstall ? (
    <IconButton icon={codex.button.icon} label={codex.button.label} title={codex.button.title} onClick={onInstall} testId="harness-action" accent={codex.button.icon === 'update'} />
  ) : null
  return (
    <span role="group" aria-label="Harness in Codex" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%' }} data-testid="harness-codex-line">
      {codex.state === 'hooks' && onApproveHooks !== undefined ? (
        <button type="button" style={{ ...textStyle, ...codexLineText, fontFamily: 'inherit', color: codex.tone, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline dotted' }} title={codex.title} onClick={onApproveHooks} data-testid="harness-codex" data-state={codex.state}>
          {codex.text}
        </button>
      ) : (
        <span style={{ ...textStyle, ...codexLineText, color: codex.tone }} title={codex.title} data-testid="harness-codex" data-state={codex.state}>
          {codex.text}
        </span>
      )}
      {button}
    </span>
  )
}

/** The Harness line: its text, what an update removed, and its buttons — the action, then "Move old Harness…". */
export function HarnessLine({ status, busy, failure, onInstall, onMigrate, harnessBehind = null }: HarnessStatusViewProps) {
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
  const { text, title, tone, button } = harnessPart(status, harnessBehind)
  const cleanup = cleanupPart(status.cleanup ?? [])
  return (
    <span role="group" aria-label="Harness" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, maxWidth: '100%' }} data-testid="harness-status" data-state={status.state.kind}>
      <span style={{ ...textStyle, color: tone }} title={title ?? text} data-testid="harness-text">
        {text}
      </span>
      {cleanup === null ? null : (
        <span style={{ ...textStyle, color: cleanup.tone }} title={cleanup.title} data-testid="harness-cleanup" data-state={cleanup.state}>
          · {cleanup.text}
        </span>
      )}
      {button === null ? null : <IconButton icon={button.icon} label={button.label} title={button.title} onClick={onInstall} testId="harness-action" accent={button.accent} />}
      {onMigrate === undefined ? null : <IconButton icon="migrate" label="Move old Harness…" onClick={onMigrate} testId="harness-migrate" />}
    </span>
  )
}

/**
 * What the line adds after an update that removed, or failed to remove, a plugin an older Harness had
 * worfy install (worfy-skills ticket 03): the plugins' names, and in the tooltip each line of main,
 * with the command that puts a removed plugin back or the output of the failed one.
 */
function cleanupPart(cleanup: NonNullable<Status['cleanup']>): { state: 'removed' | 'failed'; text: string; title: string; tone: string } | null {
  if (cleanup.length === 0) return null
  const names = (outcome: 'removed' | 'failed'): string[] => [...new Set(cleanup.filter((each) => each.outcome === outcome).map((each) => each.id.split('@')[0] ?? each.id))]
  const removed = names('removed')
  const failed = names('failed')
  const text = [removed.length === 0 ? '' : `removed ${removed.join(', ')}`, failed.length === 0 ? '' : `could not remove ${failed.join(', ')}`].filter((part) => part !== '').join('; ')
  const title = cleanup.map((each) => each.text).join('\n\n')
  return failed.length === 0 ? { state: 'removed', text, title, tone: 'var(--text-muted)' } : { state: 'failed', text, title, tone: 'var(--blocked-text)' }
}

/** The Harness lines with their own state over IPC: Settings → Pipeline, when the Harness is too old for the editor. */
export function HarnessStatus() {
  const { dialogs, ...view } = useHarnessStatus()
  return (
    <>
      <HarnessStatusView {...view} />
      {dialogs}
    </>
  )
}
