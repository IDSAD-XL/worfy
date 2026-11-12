// The Settings window of worfy (worfy-ui ticket 2): a modal dialog over the app window, its
// sections in a column on the left, the chosen section on the right. Placed and drawn like the
// First run screen (docs/design/F-SPEC.md, "First run", "Place"). Each section is its own file
// (sections.ts); this file does not change when one is added.
//
// It opens from the app menu's "Settings…" (Cmd/Ctrl+,, `menu.command`) and from the command
// palette, through openSettings (settings-window.ts). Esc and Close close it, and the focus goes
// back where it was. The window is modal, the Dialog of the kit (theme/kit/Dialog.tsx): while it is
// open the app behind it gets neither keys nor the focus, so Esc closes this window and not focus
// mode or a popover under it, and ⌘K, ⌘F and ⌘↩ do nothing. A press on the backdrop leaves it open.
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import '../canvas/actions/actions.css'
import { Dialog } from '../theme/kit/Dialog'
import { ListRow } from '../theme/primitives'
import './settings.css'
import { settingsSections, type SettingsSection } from './sections'
import { closeSettings, followMenuCommands, selectSection, useSettingsWindow } from './settings-window'

export interface SettingsDialogViewProps {
  sections: readonly SettingsSection[]
}

/** The window over the given sections; open and closed by settings-window.ts. */
export function SettingsDialogView({ sections }: SettingsDialogViewProps) {
  const { open, section } = useSettingsWindow()
  const titleId = useId()
  const headingId = useId()
  const nav = useRef<HTMLDivElement>(null)

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

  return (
    <Dialog
      open={open}
      onClose={closeSettings}
      labelledBy={titleId}
      className="w-settings"
      backdropClassName="w-settings__backdrop"
      // A press on the backdrop leaves the window open.
      closeOnBackdrop={false}
      // The chosen section, so ↑ and ↓ work at once.
      initialFocus={() => nav.current?.querySelector<HTMLElement>('[aria-current="true"]')}
      data-testid="settings"
    >
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
    </Dialog>
  )
}

/** The Settings window of the app: the section files next to it; opens on the menu's "Settings…". */
export function SettingsDialog() {
  useEffect(followMenuCommands, [])
  return <SettingsDialogView sections={settingsSections} />
}
