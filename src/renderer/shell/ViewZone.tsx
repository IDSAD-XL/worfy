// The View buttons of one zone of the window (worfy-layout ticket 04; spec, the section on one button in three looks): the
// header's group (Toolbar.tsx), the block of the rail under a line (Sidebar.tsx) and the left of the footer
// (footer/Footer.tsx) each draw the buttons the layout puts in them, in its order. The layout is `viewButtons` of the app
// settings of this Machine (src/shared/layout/view-buttons.ts); a window on a Linked machine's Project shows it too, as
// the settings channels are `local` (viewButtonsOf, src/shared/settings/app-settings.ts).
//
// A zone is one kit ToggleGroup: one Tab stop, the arrows walk it (↑ and ↓ on the rail), and the button of the view on
// screen is pressed, in whatever zone it stands. A zone without buttons draws nothing. While the sidebar is hidden the
// rail is not drawn, and its buttons stand at the end of the header after a line (owner's decision A, 2026-11-25): the
// layout does not change. In focus mode the buttons of the rail and the footer are inert, as the header is under the
// layer (FocusMode.tsx): under the layer the view is not seen, so there is nothing to switch.
//
// Moving a button (worfy-layout ticket 05; spec, the sections on the menu of a View button and on the keys): a right
// click, a click with two fingers or Shift+F10 opens the button's menu — Move to Header, Sidebar or Footer (the zone it
// stands in checked and inactive), a line, Reset layout (inactive at the default). Move to puts it at the end of that
// zone; while the sidebar is hidden, Sidebar puts it at the end of the rail, and it shows in the header after the line.
// ⌥← and ⌥→ in the header and the footer, ⌥↑ and ⌥↓ on the rail, move the focused button within its zone, and at the
// edge of the zone do nothing: only the menu takes a button to another zone. The rail's buttons drawn in the header move
// within the rail with ⌥← and ⌥→. Each move is one `appSettings.set` of the whole layout, Reset layout one with `null`;
// every window of this Machine hears it. The button keeps the focus after the zones are drawn again, in its new zone.
import { useLayoutEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { isDefault, moveToZone, moveWithin, VIEW_ZONES, type ViewButtonId, type ViewButtons, type ViewZone as Zone } from '../../shared/layout/view-buttons'
import { useFocusState } from '../focus/focus-state'
import { setAppSettings } from '../settings/useAppSettings'
import { ContextMenu, ContextMenuSeparator, type ContextMenuPoint } from '../theme/kit/ContextMenu'
import { MenuItem, MenuRadioGroup, MenuRadioItem } from '../theme/kit/Menu'
import { ToggleGroup } from '../theme/kit/ToggleGroup'
import type { ShellView, ToolbarProject } from './Toolbar'
import { ViewButton } from './ViewButton'
import { openView, viewButtonOf, type ViewButtonEntry } from './views'

/** Which View button sits in which zone, in order. */
export type ViewLayout = Readonly<Record<Zone, readonly ViewButtonId[]>>

/** What the zones need from the shell: the layout, the view on screen, the open Project and the switch of the main area. */
export interface ViewSwitch {
  layout: ViewLayout
  view: ShellView
  project: ToolbarProject | undefined
  onViewChange: (view: ShellView) => void
}

/** The accessible name of each zone's group: the header's keeps the name of the View switch it replaces. */
const GROUP_NAMES: Record<Zone, string> = { header: 'View', rail: 'Views', footer: 'Views' }

export interface ViewZoneProps {
  zone: Zone
  views: ViewSwitch
  /** In the header: the rail's buttons follow, after a line, while the sidebar is hidden. */
  withRail?: boolean
  /** On the rail: the names of the sidebar's sections; a View button of the same name shows no badge (owner's decision B). */
  sectionNames?: ReadonlySet<string>
}

const entriesOf = (ids: readonly ViewButtonId[]): ViewButtonEntry[] => ids.flatMap((id) => viewButtonOf(id) ?? [])

/** The names of the zones in the menu: the rail is the Sidebar there (Q3). */
const ZONE_NAMES: Record<Zone, string> = { header: 'Header', rail: 'Sidebar', footer: 'Footer' }

/** The keys that move a button within its zone, by the look it is drawn in: back (-1) or on (+1). */
const STEPS: Record<Zone, Partial<Record<string, -1 | 1>>> = {
  header: { ArrowLeft: -1, ArrowRight: 1 },
  rail: { ArrowUp: -1, ArrowDown: 1 },
  footer: { ArrowLeft: -1, ArrowRight: 1 },
}

/**
 * The button a menu or a key has just moved: the zones give it the focus once the new layout is drawn, wherever it
 * stands then. One for the whole window: each id stands in one zone, and a move to another zone draws it in another
 * ViewZone than the one that moved it.
 */
let focusAfterMove: ViewButtonId | null = null

/** Asks main for the layout `next` (`null` — Reset layout) and has the button `id` keep the focus once it is drawn. */
function place(next: ViewButtons | null, id: ViewButtonId): void {
  focusAfterMove = id
  void setAppSettings({ viewButtons: next }).then((error) => {
    if (error === undefined) return
    if (focusAfterMove === id) focusAfterMove = null
    console.error('Moving a View button failed:', error)
  })
}

const check = (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8.5l3.2 3L13 4.5" />
  </svg>
)

/** The menu of one button: on which button it opened, the zone of the layout that button stands in, and where. */
interface OpenMenu {
  id: ViewButtonId
  label: string
  zone: Zone
  opener: HTMLElement
  /** `null` once it closes: the last menu stays drawn while it goes. */
  at: ContextMenuPoint | null
}

/** Under the button: where a key opens its menu (Shift+F10, or the menu key of Windows, which brings no point). */
function under(button: HTMLElement): ContextMenuPoint {
  const box = button.getBoundingClientRect()
  return { x: box.left, y: box.bottom }
}

export function ViewZone({ zone, views, withRail = false, sectionNames }: ViewZoneProps) {
  const focusMode = useFocusState((state) => state.active)
  const { layout, view, project, onViewChange } = views
  const [menu, setMenu] = useState<OpenMenu | null>(null)

  // The button a move asked for gets the focus once the layout that moved it is drawn, as QueueList's grip does.
  useLayoutEffect(() => {
    const id = focusAfterMove
    if (id === null) return
    const moved = document.querySelector<HTMLElement>(`[data-view-button="${id}"]`)
    if (moved === null) return
    focusAfterMove = null
    if (document.activeElement !== moved) moved.focus()
  }, [layout])

  const own = entriesOf(layout[zone])
  const guests = zone === 'header' && withRail ? entriesOf(layout.rail) : []
  const placed = [...own, ...guests]
  if (placed.length === 0) return null
  const pressed = placed.some((entry) => entry.id === view) ? view : null

  const openMenu = (entry: ViewButtonEntry, entryZone: Zone, opener: HTMLElement, at: ContextMenuPoint) => {
    const id = layout[entryZone].find((each) => each === entry.id)
    if (id !== undefined) setMenu({ id, label: entry.button.label, zone: entryZone, opener, at })
  }
  const onContextMenu = (entry: ViewButtonEntry, entryZone: Zone) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const opener = event.currentTarget
    openMenu(entry, entryZone, opener, event.clientX === 0 && event.clientY === 0 ? under(opener) : { x: event.clientX, y: event.clientY })
  }
  // The item's handler runs before the group's own arrows: ⌥← must not move the focus along the group.
  const onKeyDown = (entry: ViewButtonEntry, entryZone: Zone) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.metaKey || event.ctrlKey) return
    if (event.key === 'F10' && event.shiftKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      openMenu(entry, entryZone, event.currentTarget, under(event.currentTarget))
      return
    }
    const step = event.altKey && !event.shiftKey ? STEPS[zone][event.key] : undefined
    if (step === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const buttons = layout[entryZone]
    const from = buttons.findIndex((each) => each === entry.id)
    const id = buttons[from]
    const to = from + step
    if (id === undefined || to < 0 || to >= buttons.length) return
    place(moveWithin(layout, entryZone, from, to), id)
  }

  const button = (entryZone: Zone) => (entry: ViewButtonEntry) => (
    <ViewButton
      key={entry.id}
      entry={entry}
      look={zone}
      zone={entryZone}
      inactive={entry.button.needsProject !== undefined && project === undefined}
      badged={zone !== 'rail' || sectionNames?.has(entry.button.label) !== true}
      onContextMenu={onContextMenu(entry, entryZone)}
      onKeyDown={onKeyDown(entry, entryZone)}
    />
  )
  return (
    <>
      <ToggleGroup
        aria-label={GROUP_NAMES[zone]}
        className={zone === 'header' ? 'w-segmented w-view-zone w-view-zone--header' : `w-view-zone w-view-zone--${zone}`}
        orientation={zone === 'rail' ? 'vertical' : 'horizontal'}
        data-zone={zone}
        // The header's labels give way at 1400 px from four buttons on (shell.css).
        data-count={placed.length}
        inert={zone !== 'header' && focusMode}
        value={pressed}
        // A press opens the view as its entry says (views.tsx): Runs at the newest Run, the others switch the main area. A
        // press on the pressed button opens its view again, as the View switch did.
        onValueChange={(next) => {
          const entry = viewButtonOf(next ?? view)
          if (entry !== undefined) void openView(entry, project, onViewChange)
        }}
      >
        {own.map(button(zone))}
        {own.length > 0 && guests.length > 0 ? <span className="w-view-zone__line" aria-hidden="true" /> : null}
        {guests.map(button('rail'))}
      </ToggleGroup>
      {menu === null ? null : (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu((open) => (open === null ? null : { ...open, at: null }))}
          label={`${menu.label} View button`}
          opener={menu.opener}
          className="w-view-menu"
          testId="view-button-menu"
        >
          <MenuRadioGroup value={menu.zone} heading="Move to" headingClassName="w-view-menu__heading">
            {VIEW_ZONES.map((target) => (
              <MenuRadioItem
                key={target}
                value={target}
                className="w-row"
                closeOnClick
                disabled={target === menu.zone}
                data-zone={target}
                onClick={() => place(moveToZone(layout, menu.id, target), menu.id)}
              >
                <span className="w-view-menu__check">{target === menu.zone ? check : null}</span>
                {ZONE_NAMES[target]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <ContextMenuSeparator />
          <MenuItem className="w-row" disabled={isDefault(layout)} onClick={() => place(null, menu.id)}>
            Reset layout
          </MenuItem>
        </ContextMenu>
      )}
    </>
  )
}
