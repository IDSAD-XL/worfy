import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { invoke } from '../ipc'

// The version chip of the toolbar (worfy-update ticket 06; spec items 5 and 6, R11, R12): the app
// version on the second line of the Harness item (src/renderer/shell/toolbar/HarnessStatus.tsx), in
// the same small line as before. With an Update to install it becomes a button: an accent dot while
// there is something to do (an Available update that is not quiet, a build that runs, is ready or
// failed), a tooltip that says what, and a menu — "Update worfy" (`update.install`), once built
// "Restart now" or "Restart when idle" (`update.restart`), while it builds an inactive "Building worfy
// <version>…" — and "Later", which only closes the menu: the dot stays until the Update is installed.
// Without Update in this copy (`enabled: false`), or with nothing to install, it is the plain line.
// Texts: .scratch/worfy-update/spec.md, its section of the draft texts. Main answers each press with
// `update.changed`, which the store (src/renderer/update/store.ts) takes; the chip draws the snapshot
// it is given.
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
  zIndex: 90,
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

interface MenuProps {
  signal: Signal
  idle: boolean
  anchor: HTMLElement
  onClose: () => void
}

/**
 * The chip's menu, drawn over everything under the chip with its left edge on the chip's. Escape, a
 * click elsewhere, the window losing focus and choosing an item close it; the focus goes back to the chip.
 */
function ChipMenu({ signal, idle, anchor, onClose }: MenuProps) {
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
    const outside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!menu.current?.contains(target) && !anchor.contains(target)) close.current()
    }
    const blur = (): void => close.current()
    document.addEventListener('mousedown', outside)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('mousedown', outside)
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

  let first
  if (signal.phase === 'building') {
    first = (
      <button type="button" role="menuitem" className="w-row" aria-disabled="true" style={{ color: 'var(--text-muted)' }}>
        {TOOLTIP.building(signal.version)}
      </button>
    )
  } else if (signal.phase === 'ready') {
    const when = idle ? 'now' : 'idle'
    first = (
      <button type="button" role="menuitem" className="w-row" onClick={choose(() => restart(when))}>
        {idle ? 'Restart now' : 'Restart when idle'}
      </button>
    )
  } else {
    first = (
      <button type="button" role="menuitem" className="w-row" onClick={choose(install)}>
        Update worfy
      </button>
    )
  }

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
  /** Main's Update snapshot; null until it has answered. */
  update: UpdateSnapshot | null
}

/** The app version line of the toolbar, a button with a dot and a menu while an Update waits. */
export default function UpdateChip({ version, update }: UpdateChipProps) {
  // The chip while its menu is open, else null.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const signal = updateSignal(update)
  if (signal === null) {
    // The signal went (installed from Settings or another window): the menu goes with it, so a later
    // signal shows a closed chip rather than a menu that opens by itself. Adjusted during render, as
    // React advises for state that follows a prop.
    if (anchor !== null) setAnchor(null)
    return (
      <small className="w-mono w-toolbar__version" data-testid="app-version">
        v{version}
      </small>
    )
  }
  return (
    <>
      <button
        type="button"
        className="w-mono w-toolbar__version w-toolbar__version-chip"
        title={TOOLTIP[signal.phase](signal.version)}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-testid="app-version"
        data-update={signal.phase}
        onClick={(event) => {
          const target = event.currentTarget
          setAnchor((was) => (was === null ? target : null))
        }}
      >
        v{version}
        {signal.dot ? <span className="w-update-dot" aria-hidden="true" /> : null}
      </button>
      {anchor === null ? null : <ChipMenu signal={signal} idle={update?.idle ?? false} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  )
}
