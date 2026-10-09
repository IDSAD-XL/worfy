// The Settings window of worfy (worfy-ui ticket 2): a modal dialog over the app window, its
// sections in a column on the left, the chosen section on the right. Placed and drawn like the
// First run screen (docs/design/F-SPEC.md, "First run", "Place"). Each section is its own file
// (sections.ts); this file does not change when one is added.
//
// It opens from the app menu's "Settings…" (Cmd/Ctrl+,, `menu.command`) and from the command
// palette, through openSettings (settings-window.ts). Esc and Close close it, and the focus goes
// back where it was. The window keeps Esc to itself: an Esc that reached the app window would also
// close focus mode under it.
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import '../canvas/actions/actions.css'
import { ListRow } from '../theme/primitives'
import './settings.css'
import { settingsSections, type SettingsSection } from './sections'
import { closeSettings, followMenuCommands, selectSection, useSettingsWindow } from './settings-window'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface SettingsDialogViewProps {
  sections: readonly SettingsSection[]
}

/** The window over the given sections; open and closed by settings-window.ts. */
export function SettingsDialogView({ sections }: SettingsDialogViewProps) {
  const { open, section } = useSettingsWindow()
  const titleId = useId()
  const headingId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLDivElement>(null)

  // On opening: the focus goes to the chosen section, so ↑ and ↓ work at once; on closing it goes
  // back to what had it before, if that is still on the page.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const selected = nav.current?.querySelector<HTMLElement>('[aria-current="true"]')
    ;(selected ?? dialog.current)?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  if (!open) return null

  const index = Math.max(
    0,
    sections.findIndex((each) => each.id === section),
  )
  const shown = sections[index]

  const moveTo = (next: number): void => {
    const target = sections[next]
    if (target === undefined) return
    selectSection(target.id)
    nav.current?.querySelectorAll<HTMLElement>('.w-row')[next]?.focus()
  }

  const onNavKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    moveTo(event.key === 'ArrowDown' ? Math.min(index + 1, sections.length - 1) : Math.max(index - 1, 0))
  }

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === 'Escape') {
      // A control inside that closes something of its own on Esc (an open Select list) has
      // prevented it already.
      if (event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      closeSettings()
      return
    }
    if (event.key !== 'Tab' || dialog.current === null) return
    // Modal: Tab and Shift+Tab go round the controls of the window.
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (first === undefined || last === undefined) return
    const active = document.activeElement
    if (event.shiftKey && (active === first || !dialog.current.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !dialog.current.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="w-settings__backdrop"
      // A press on the backdrop must not take the focus out of the modal window.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault()
      }}
    >
      <div ref={dialog} className="w-settings" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="settings" onKeyDown={onKeyDown}>
        <div className="w-settings__main">
          <div ref={nav} className="w-settings__nav" role="navigation" aria-label="Settings sections" onKeyDown={onNavKeyDown}>
            <p id={titleId} className="w-settings__nav-title">
              Settings
            </p>
            <div className="w-settings__nav-list">
              {sections.map((each) => (
                <ListRow key={each.id} label={each.title} selected={each === shown} onSelect={() => selectSection(each.id)} />
              ))}
            </div>
          </div>
          {shown !== undefined ? (
            <section className="w-settings__pane" aria-labelledby={headingId} data-section={shown.id}>
              <h2 id={headingId} className="w-settings__title">
                {shown.title}
              </h2>
              <div className="w-settings__body">
                <shown.Component key={shown.id} />
              </div>
            </section>
          ) : null}
        </div>
        <div className="w-settings__footer">
          <button type="button" className="w-action w-action--primary" data-testid="settings-close" onClick={closeSettings}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The Settings window of the app: the section files next to it; opens on the menu's "Settings…". */
export function SettingsDialog() {
  useEffect(followMenuCommands, [])
  return <SettingsDialogView sections={settingsSections} />
}
