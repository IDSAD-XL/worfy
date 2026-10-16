// The Keyboard shortcuts window (worfy-ui ticket 11): every entry of the registry of shortcuts
// (src/shared/shortcuts.ts) this system has, in groups, each row with what the keys do and the keys
// as this system writes them. A modal dialog over the app window, drawn like the Settings window and
// in its layer (SETTINGS_LAYER), above focus mode.
//
// It opens from Help ▸ Keyboard Shortcuts of the app menu (Cmd/Ctrl+/, `menu.command`), from "?"
// pressed outside a text field and outside a Terminal Node, and from the palette's "Keyboard
// shortcuts" (shortcuts-window.ts). On Windows and Linux the menu item does not take Ctrl+/ (the
// shell of a Terminal Node keeps it): this file catches it, outside a terminal. Settings → Shortcuts
// shows the same list (ShortcutList). Esc and Close close it, and the focus goes back where it was.
import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SHORTCUT_GROUPS, SHORTCUT_LIST, SHORTCUTS } from '../../shared/shortcuts'
import '../canvas/actions/actions.css'
import { currentPlatform, type Platform } from '../platform'
import { SETTINGS_LAYER } from '../settings/settings-window'
import { availableOn, isInTerminalNode, isTextTarget, label, matches, rendererCatches } from './match'
import { closeShortcuts, followShortcutsCommands, openShortcuts, setShortcutsDialogElement, useShortcutsWindow } from './shortcuts-window'
import './shortcuts.css'

export interface ShortcutListProps {
  /** The system whose entries and labels are shown; the window's own by default. */
  platform?: Platform
}

/** The entries of the registry in the groups of the window; a group with no entry on this system is left out. */
export function ShortcutList({ platform = currentPlatform() }: ShortcutListProps) {
  const groups = SHORTCUT_GROUPS.map((group) => ({ group, rows: SHORTCUT_LIST.filter((shortcut) => shortcut.group === group && availableOn(shortcut, platform)) })).filter(
    ({ rows }) => rows.length > 0,
  )
  return (
    <div className="w-shortcut-list" data-testid="shortcut-list">
      {groups.map(({ group, rows }) => (
        <section key={group} className="w-shortcut-list__group" aria-label={group}>
          <h3 className="w-shortcut-list__heading">{group}</h3>
          <ul className="w-shortcut-list__rows">
            {rows.map((shortcut) => (
              <li key={shortcut.id} className="w-shortcut-list__row" data-shortcut={shortcut.id}>
                <span className="w-shortcut-list__title">{shortcut.title}</span>
                <kbd className="w-shortcut-list__keys">{label(shortcut, platform)}</kbd>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** "?" outside a text field and a Terminal Node, and Ctrl+/ where the menu does not take it. */
function opensWindow(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false
  if (matches(event, SHORTCUTS.shortcutsKey)) return !isTextTarget(event.target) && !isInTerminalNode(event.target)
  return rendererCatches(SHORTCUTS.shortcuts) && matches(event, SHORTCUTS.shortcuts)
}

/** The window of the app: mounted once by the shell (AppShell.tsx), on screen while it is open. */
export function ShortcutsOverlay() {
  const open = useShortcutsWindow((state) => state.open)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(followShortcutsCommands, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!opensWindow(event)) return
      event.preventDefault()
      openShortcuts()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // On opening: the guard learns the dialog and the focus goes to the list, so the arrows scroll it
  // at once; on closing it goes back to what had it before, if that is still on the page. A layout
  // effect: no key may fall between the dialog appearing and the guard knowing it.
  useLayoutEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setShortcutsDialogElement(dialog.current)
    body.current?.focus()
    return () => {
      setShortcutsDialogElement(null)
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      className="w-shortcuts__backdrop"
      style={{ zIndex: SETTINGS_LAYER }}
      data-testid="shortcuts-backdrop"
      // A press on the backdrop closes the window and does not take the focus out of it first.
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        closeShortcuts()
      }}
    >
      <div ref={dialog} className="w-shortcuts" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="shortcuts">
        <h2 id={titleId} className="w-shortcuts__title">
          Keyboard shortcuts
        </h2>
        <div ref={body} className="w-shortcuts__body" tabIndex={-1} data-shortcuts-stop="">
          <ShortcutList />
        </div>
        <div className="w-shortcuts__footer">
          <button type="button" className="w-action w-action--primary" data-shortcuts-stop="" data-testid="shortcuts-close" onClick={closeShortcuts}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
