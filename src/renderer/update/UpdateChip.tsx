import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { buildVersionTooltip, numberedVersion } from '../../shared/version-number'
import { invoke } from '../ipc'
import { updateVersionLabel } from './store'
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

const menuStyle: CSSProperties = {
  position: 'fixed',
  // Over the toasts (z-index 120, src/renderer/toast/toast.css), as "What's new": the sticky Update
  // toast of the start lies right under the chip.
  zIndex: 130,
  minWidth: 180,
  padding: 'var(--space-1)',
  borderRadius: 'var(--radius-popover)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-node)',
}

function install(): void {
  void invoke('update.install').then((result) => {
    if (!result.ok) console.error('update.install failed:', result.error)
  })
}

function restart(when: 'now' | 'idle'): void {
  void invoke('update.restart', { when }).then((result) => {
    if (!result.ok) console.error('update.restart failed:', result.error)
    else if (result.value.outcome === 'refused') console.warn(`update.restart (${when}) refused: ${result.value.reason}`)
  })
}

/** The first item of the menu and the button of "What's new": without `run`, inactive. */
function primaryOf(signal: Signal, idle: boolean, label: (version: string) => string): WhatsNewAction {
  if (signal.phase === 'building') return { label: TOOLTIP.building(label(signal.version)) }
  if (signal.phase === 'ready') return idle ? { label: 'Restart now', run: () => restart('now') } : { label: 'Restart when idle', run: () => restart('idle') }
  return { label: 'Update worfy', run: install }
}

interface MenuProps {
  primary: WhatsNewAction
  anchor: HTMLElement
  onClose: () => void
  onWhatsNew: () => void
}

/**
 * The chip's menu, drawn over everything under the chip with its left edge on the chip's. Escape, a
 * click elsewhere, the focus elsewhere in the window, the window losing focus and choosing an item close it; the focus goes back to the chip.
 */
function ChipMenu({ primary, anchor, onClose, onWhatsNew }: MenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  // 4px under the chip, its left edge on the chip's; the toolbar does not move while the menu is open.
  const [place] = useState(() => {
    const box = anchor.getBoundingClientRect()
    return { left: box.left, top: box.bottom + 4 }
  })

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const outside = (event: Event): void => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !anchor.contains(target)) close.current()
    }
    const blur = (): void => close.current()
    document.addEventListener('mousedown', outside)
    // The focus elsewhere in the window (the Command palette's field on ⌘K): the menu lies over the
    // toasts and the palette, so it must not stay open under the focus.
    document.addEventListener('focusin', outside)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('blur', blur)
    }
  }, [anchor])

  const choose = (action: () => void) => () => {
    close.current()
    anchor.focus()
    action()
  }
  const move = (step: number): void => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + step + items.length) % items.length]?.focus()
  }

  const { run } = primary
  const first =
    run === undefined ? (
      <button type="button" role="menuitem" className="w-row" aria-disabled="true" style={{ color: 'var(--text-muted)' }}>
        {primary.label}
      </button>
    ) : (
      <button type="button" role="menuitem" className="w-row" onClick={choose(run)}>
        {primary.label}
      </button>
    )

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="worfy update"
      style={{ ...menuStyle, ...place }}
      data-testid="update-chip-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close.current()
          anchor.focus()
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(event.key === 'ArrowDown' ? 1 : -1)
        }
      }}
    >
      {first}
      <button
        type="button"
        role="menuitem"
        className="w-row"
        // The popover takes the menu's place and the focus; the chip gets it back when it closes.
        onClick={onWhatsNew}
      >
        What's new
      </button>
      <button type="button" role="menuitem" className="w-row" onClick={choose(() => undefined)}>
        Later
      </button>
    </div>,
    document.body,
  )
}

export interface UpdateChipProps {
  /** The app version (`app.version`). */
  version: string
  /** Its build number (`app.version`, ticket 14); without it the line shows `version` itself. */
  number?: number | undefined
  /** Main's Update snapshot; null until it has answered. */
  update: UpdateSnapshot | null
}

/** The app version line of the toolbar, a button with a dot and a menu while an Update waits. */
export default function UpdateChip({ version, number, update }: UpdateChipProps) {
  // The chip while its menu or "What's new" is open, else null.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [view, setView] = useState<'menu' | 'whatsNew'>('menu')
  const signal = updateSignal(update)
  const shown = numberedVersion(version, number)
  const label = (each: string): string => updateVersionLabel(update, each, { version, number })
  if (signal === null) {
    // The signal went (installed from Settings or another window): the menu goes with it, so a later
    // signal shows a closed chip rather than a menu that opens by itself. Adjusted during render, as
    // React advises for state that follows a prop.
    if (anchor !== null) setAnchor(null)
    return (
      <small className="w-mono w-toolbar__version" data-testid="app-version" title={buildVersionTooltip(version, number)}>
        v{shown}
      </small>
    )
  }
  const primary = primaryOf(signal, update?.idle ?? false, label)
  return (
    <>
      <button
        type="button"
        className="w-mono w-toolbar__version w-toolbar__version-chip"
        title={TOOLTIP[signal.phase](label(signal.version))}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-testid="app-version"
        data-update={signal.phase}
        onClick={(event) => {
          const target = event.currentTarget
          setView('menu')
          setAnchor((was) => (was === null ? target : null))
        }}
      >
        v{shown}
        {signal.dot ? <span className="w-update-dot" aria-hidden="true" /> : null}
      </button>
      {anchor === null ? null : view === 'menu' ? (
        <ChipMenu
          primary={primary}
          anchor={anchor}
          onClose={() => setAnchor(null)}
          onWhatsNew={() => setView('whatsNew')}
        />
      ) : (
        <WhatsNew version={signal.version} label={label} anchor={anchor} action={primary} onClose={() => setAnchor(null)} />
      )}
    </>
  )
}
