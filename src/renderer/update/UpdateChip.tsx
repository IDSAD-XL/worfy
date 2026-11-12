import { useState } from 'react'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { buildVersionTooltip, numberedVersion } from '../../shared/version-number'
import { invoke } from '../ipc'
import { Menu, MenuItem } from '../theme/kit/Menu'
import { buildStepText, elapsedText, installUpdateTelling, updateVersionLabel, useTicking, useUpdateStore } from './store'
import WhatsNew, { type WhatsNewAction } from './WhatsNew'

// The version chip of the toolbar (worfy-update ticket 06; spec items 5 and 6, R11, R12): the app
// version on the second line of the Harness item (src/renderer/shell/toolbar/HarnessStatus.tsx), in
// the same small line as before. With an Update to install it becomes a button: an accent dot while
// there is something to do (an Available update that is not quiet, a build that runs, is ready or
// failed), a tooltip that says what, and a menu — "Update worfy" (`update.install`), once built
// "Restart now" or "Restart when idle" (`update.restart`), while it builds an inactive "Building worfy
// <version>…" —, "What's new" (ticket 10: a popover under the chip with the PRs merged since the copy
// that runs, src/renderer/update/WhatsNew.tsx) and "Later", which only closes the menu: the dot stays
// until the Update is installed.
// Without Update in this copy (`enabled: false`), or with nothing to install, it is the plain line.
// Texts: .scratch/worfy-update/spec.md, its section of the draft texts. Main answers each press with
// `update.changed`, which the store (src/renderer/update/store.ts) takes; the chip draws the snapshot
// it is given.
//
// The versions show numbered, `v<major>.<minor>.<N>` (worfy-update ticket 14,
// src/shared/version-number.ts), where the build number is known; the plain line then has the full
// build version with its commit as its tooltip. Without a number, everything reads as before.
//
// While an Update is under way (ticket 16) the line says so without a hover, a spinner in place of
// the dot: "Starting update…" from the press until the build reaches its first step, then
// "Updating · 2/3 Installing dependencies"; the tooltip adds the time since the build began,
// counting each second while the pointer or the focus is on the chip. A refused press is a toast
// (store.ts, tellInstallRefusal). Once a restart began, "Restarting…" until the window closes.
//
// worfy-polish ticket 48: the step is no wider than the Harness line above it and ends with an
// ellipsis (src/renderer/shell/shell.css, .w-toolbar__version-step), so a build does not widen the
// toolbar; the whole step is the first line of the tooltip. When the button gives way to the plain
// line, the pointer and the focus on it are forgotten: no mouseleave or blur comes from a button that
// is gone, and the time would count on without anyone on the chip once it is a button again.
//
// It lives here, not in src/renderer/shell/toolbar/: every .tsx file there is a toolbar item of its
// own (src/renderer/shell/Toolbar.tsx), and the chip is a part of the Harness item.

type Phase = 'available' | 'building' | 'ready' | 'failed'

interface Signal {
  phase: Phase
  version: string
  /** The accent dot: anything but a quiet Available update (the commit the user rolled back from). */
  dot: boolean
}

/** What the chip offers for a snapshot, or null when it is the plain line. */
function updateSignal(update: UpdateSnapshot | null): Signal | null {
  if (update === null || !update.enabled) return null
  const { available, build } = update
  if (build.phase !== 'idle') {
    const version = build.version ?? available?.version
    if (version !== undefined) return { phase: build.phase, version, dot: true }
  }
  if (available !== null) return { phase: 'available', version: available.version, dot: !available.quiet }
  return null
}

const TOOLTIP: Record<Phase, (version: string) => string> = {
  available: (version) => `worfy ${version} is available`,
  building: (version) => `Building worfy ${version}…`,
  ready: (version) => `worfy ${version} is ready — restart to update`,
  failed: (version) => `The update to ${version} failed — see Settings → Health`,
}

/** The Update's text, and under it the build version with its commit when the line shows a number (ticket 14). */
function withBuild(text: string, build: string | undefined): string {
  return build === undefined ? text : `${text}\n${build}`
}

function install(update: UpdateSnapshot | null): void {
  void installUpdateTelling(update)
}

function restart(when: 'now' | 'idle'): void {
  void invoke('update.restart', { when }).then((result) => {
    if (!result.ok) console.error('update.restart failed:', result.error)
    else if (result.value.outcome === 'refused') console.warn(`update.restart (${when}) refused: ${result.value.reason}`)
  })
}

/** The first item of the menu and the button of "What's new": without `run`, inactive. */
function primaryOf(signal: Signal, update: UpdateSnapshot | null, label: (version: string) => string): WhatsNewAction {
  const idle = update?.idle ?? false
  if (signal.phase === 'building') return { label: TOOLTIP.building(label(signal.version)) }
  if (signal.phase === 'ready') return idle ? { label: 'Restart now', run: () => restart('now') } : { label: 'Restart when idle', run: () => restart('idle') }
  return { label: 'Update worfy', run: () => install(update) }
}

export interface UpdateChipProps {
  /** The app version (`app.version`). */
  version: string
  /** Its build number (`app.version`, ticket 14); without it the line shows `version` itself. */
  number?: number | undefined
  /** Main's Update snapshot; null until it has answered. */
  update: UpdateSnapshot | null
  /** The clock of the build's elapsed time; tests give their own. */
  now?: () => number
}

/** The spinner of an Update under way; it stands still with reduced motion (shell.css). */
const spinner = <span className="w-update-spinner" aria-hidden="true" />

/** The app version line of the toolbar, a button with a dot and a menu while an Update waits. */
export default function UpdateChip({ version, number, update, now = Date.now }: UpdateChipProps) {
  // What is open under the chip: its menu, "What's new", or nothing.
  const [view, setView] = useState<'closed' | 'menu' | 'whatsNew'>('closed')
  // The chip's button, which "What's new" stands under.
  const [chip, setChip] = useState<HTMLButtonElement | null>(null)
  // The pointer or the focus on the chip: its tooltip may be open, so the elapsed time counts on.
  const [pointed, setPointed] = useState(false)
  const [focused, setFocused] = useState(false)
  const starting = useUpdateStore((store) => store.starting)
  const signal = updateSignal(update)
  const shown = numberedVersion(version, number)
  const label = (each: string): string => updateVersionLabel(update, each)
  const build = update?.build
  const startedAt = signal?.phase === 'building' ? build?.startedAt : undefined
  const time = useTicking(startedAt !== undefined && (pointed || focused), now)
  if (update?.enabled === true && update.restarting) {
    if (view !== 'closed') setView('closed')
    if (pointed) setPointed(false)
    if (focused) setFocused(false)
    return (
      <small className="w-mono w-toolbar__version w-toolbar__version-chip" data-testid="app-version" data-update="restarting" role="status">
        {spinner}
        Restarting…
      </small>
    )
  }
  if (signal === null) {
    // The signal went (installed from Settings or another window): the menu goes with it, so a later
    // signal shows a closed chip rather than a menu that opens by itself. Adjusted during render, as
    // React advises for state that follows a prop.
    if (view !== 'closed') setView('closed')
    if (pointed) setPointed(false)
    if (focused) setFocused(false)
    return (
      <small className="w-mono w-toolbar__version" data-testid="app-version" title={buildVersionTooltip(version, number)}>
        v{shown}
      </small>
    )
  }
  const primary = primaryOf(signal, update, label)
  const step = build === undefined ? undefined : buildStepText(build)
  // Under way: pressed here and not answered yet, or begun and before its first step, or at a step.
  const progress = step !== undefined ? `Updating · ${step}` : starting || signal.phase === 'building' ? 'Starting update…' : undefined
  const said = TOOLTIP[signal.phase](label(signal.version)) + (startedAt === undefined ? '' : ` ${elapsedText(startedAt, time)}`)
  const tooltip = progress === undefined ? said : `${progress}\n${said}`
  // A press on the chip while "What's new" is open closes it, as the press that opened the menu would.
  const change = (open: boolean) => setView((was) => (open ? (was === 'whatsNew' ? 'closed' : 'menu') : was === 'menu' ? 'closed' : was))
  const { run } = primary
  const trigger = (
    <button
      ref={setChip}
      type="button"
      className="w-mono w-toolbar__version w-toolbar__version-chip"
      title={withBuild(tooltip, buildVersionTooltip(version, number))}
      data-testid="app-version"
      data-update={signal.phase}
      onMouseEnter={() => setPointed(true)}
      onMouseLeave={() => setPointed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {progress === undefined ? (
        <>
          v{shown}
          {signal.dot ? <span className="w-update-dot" aria-hidden="true" /> : null}
        </>
      ) : (
        <>
          {spinner}
          <span className="w-toolbar__version-step">{progress}</span>
        </>
      )}
    </button>
  )
  // The menu is the kit's Menu (theme/kit/Menu.tsx, worfy-ui-kit ticket 11) under the chip, its left
  // edge on the chip's, on the topmost layer of the scale: over the toasts, as "What's new" — the sticky
  // Update toast of the start lies right under the chip. Choosing an item closes it and gives the focus
  // back to the chip; "What's new" takes the menu's place and the focus, and gives the focus back when it
  // closes. The focus elsewhere in the window (the Command palette's field on ⌘K) closes it too: it must
  // not stay open over the palette.
  return (
    <>
      <Menu open={view === 'menu'} onOpenChange={change} trigger={trigger} label="worfy update" testId="update-chip-menu" layer="top">
        {run === undefined ? (
          <MenuItem className="w-row" disabled style={{ color: 'var(--text-muted)' }}>
            {primary.label}
          </MenuItem>
        ) : (
          <MenuItem className="w-row" onClick={run}>
            {primary.label}
          </MenuItem>
        )}
        <MenuItem className="w-row" onClick={() => setView('whatsNew')}>
          What's new
        </MenuItem>
        <MenuItem className="w-row">Later</MenuItem>
      </Menu>
      {view === 'whatsNew' && chip !== null ? <WhatsNew version={signal.version} label={label} anchor={chip} action={primary} onClose={() => setView('closed')} /> : null}
    </>
  )
}
