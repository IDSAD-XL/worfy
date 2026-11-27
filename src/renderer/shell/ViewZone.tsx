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
// A key pressed again before main has answered steps on from the layout the last press asked for.
//
// A drag (worfy-layout ticket 06; spec, the section on the drag): native HTML5 drag and drop, as QueueList's rows
// (src/renderer/autopilot/QueueList.tsx), no library. Every View button is draggable, an inactive one too: the layout
// does not depend on the Project. While a drag goes `.w-shell` carries `data-view-drag`, every zone drawn is lit
// (`data-drop-zone="on"`) and the one under the pointer more (`"over"`), with the marker of the gap the pointer is over:
// before the button whose middle is past the pointer, or after the last one. An empty zone shows a place of one button,
// «Drop here», and only then. A drop is one `appSettings.set`; Esc or letting go outside a zone ends the drag with no
// drop, and `dragend` puts the zones out. The drag lives in this module, so a zone takes a drop only from a drag that
// began in its own window. While the sidebar is hidden the rail's buttons at the end of the header are no drop place
// (owner's decision A): past the header's own buttons is the end of the header.
import { useLayoutEffect, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { create } from 'zustand'
import { defaultViewButtons, isDefault, moveToZone, moveWithin, sameViewButtons, VIEW_ZONES, type ViewButtonId, type ViewButtons, type ViewZone as Zone } from '../../shared/layout/view-buttons'
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

/**
 * The layout the last move asked for, while main has not answered every move yet: a second ⌥→ pressed before the
 * answer steps on from it, not from the layout still drawn. `setAppSettings` takes the answer into the settings before
 * it resolves, so once the last one has, the layout drawn is the one to step from.
 */
let asked: { layout: ViewButtons; waiting: number } | null = null

/** The layout a move starts from: the one the last move asked for while main has not answered, else the one drawn. */
const startOf = (layout: ViewLayout): ViewLayout => asked?.layout ?? layout

/** Asks main for the layout `next` (`null` — Reset layout) and has the button `id` keep the focus once it is drawn. */
function place(next: ViewButtons | null, id: ViewButtonId): void {
  focusAfterMove = id
  asked = { layout: next ?? defaultViewButtons(), waiting: (asked?.waiting ?? 0) + 1 }
  void setAppSettings({ viewButtons: next }).then((error) => {
    if (asked !== null && --asked.waiting === 0) asked = null
    if (error === undefined) return
    if (focusAfterMove === id) focusAfterMove = null
    console.error('Moving a View button failed:', error)
  })
}

/** The type of the drag's data: the id of the View button. */
const DRAG_TYPE = 'application/x-worfy-view-button'

/** The drag of a View button in this window: which one, and the gap of the zone the pointer is over. */
interface ViewDrag {
  id: ViewButtonId
  over: { zone: Zone; gap: number } | null
}

const useViewDrag = create<{ drag: ViewDrag | null }>(() => ({ drag: null }))

function startDrag(id: ViewButtonId, source: HTMLElement): void {
  useViewDrag.setState({ drag: { id, over: null } })
  source.closest('.w-shell')?.setAttribute('data-view-drag', id)
}

/** Ends the drag, dropped or not: the zones go out and the header is the window's drag area again (shell.css). */
function endDrag(): void {
  if (useViewDrag.getState().drag !== null) useViewDrag.setState({ drag: null })
  for (const shell of document.querySelectorAll('[data-view-drag]')) shell.removeAttribute('data-view-drag')
}

/** The pointer is over the gap `gap` of `zone`, or over no zone (`null`). */
function overGap(over: ViewDrag['over']): void {
  const { drag } = useViewDrag.getState()
  if (drag === null || (drag.over?.zone === over?.zone && drag.over?.gap === over?.gap)) return
  useViewDrag.setState({ drag: { ...drag, over } })
}

/**
 * The gap of `zone` the pointer is over: the place of the first of its buttons whose middle is past the pointer, along
 * the row (the column on the rail), as QueueList's `gapAt` halves a row; past them all, the end. Only the zone's own
 * buttons count: the rail's drawn at the end of the header are not the header's.
 */
function gapAt(group: HTMLElement, zone: Zone, event: DragEvent<HTMLElement>): number {
  const buttons = [...group.querySelectorAll<HTMLElement>(`[data-view-button][data-zone="${zone}"]`)]
  const at = zone === 'rail' ? event.clientY : event.clientX
  const gap = buttons.findIndex((button) => {
    const box = button.getBoundingClientRect()
    return at < (zone === 'rail' ? box.top + box.height / 2 : box.left + box.width / 2)
  })
  return gap === -1 ? buttons.length : gap
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

  const drag = useViewDrag((state) => state.drag)
  const own = entriesOf(layout[zone])
  const guests = zone === 'header' && withRail ? entriesOf(layout.rail) : []
  const placed = [...own, ...guests]
  if (placed.length === 0 && drag === null) return null
  const pressed = placed.some((entry) => entry.id === view) ? view : null
  // The gap of this zone the pointer is over while a drag goes, else none.
  const gap = drag?.over?.zone === zone ? drag.over.gap : null

  const openMenu = (entry: ViewButtonEntry, entryZone: Zone, opener: HTMLElement, at: ContextMenuPoint) => {
    const id = layout[entryZone].find((each) => each === entry.id)
    if (id !== undefined) setMenu({ id, label: entry.button.label, zone: entryZone, opener, at })
  }
  // A zone takes only a drag that began in this window: the drag of this module.
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (useViewDrag.getState().drag === null) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    overGap({ zone, gap: gapAt(event.currentTarget, zone, event) })
  }
  // A leave into a button of the zone is no leave: only a point outside the zone's box puts its marker out.
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const inside = event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom
    if (!inside && useViewDrag.getState().drag?.over?.zone === zone) overGap(null)
  }
  // The gap is counted on the layout drawn, as the marker is; the button goes there among the others of the zone.
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const dragged = useViewDrag.getState().drag
    if (dragged === null) return
    event.preventDefault()
    const at = gapAt(event.currentTarget, zone, event)
    endDrag()
    const from = layout[zone].indexOf(dragged.id)
    const next = moveToZone(layout, dragged.id, zone, from !== -1 && from < at ? at - 1 : at)
    if (!sameViewButtons(next, layout)) place(next, dragged.id)
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
    const start = startOf(layout)
    const buttons = start[entryZone]
    const from = buttons.findIndex((each) => each === entry.id)
    const id = buttons[from]
    const to = from + step
    if (id === undefined || to < 0 || to >= buttons.length) return
    place(moveWithin(start, entryZone, from, to), id)
  }

  const button = (entryZone: Zone) => (entry: ViewButtonEntry, index: number) => (
    <ViewButton
      key={entry.id}
      entry={entry}
      look={zone}
      zone={entryZone}
      inactive={entry.button.needsProject !== undefined && project === undefined}
      badged={zone !== 'rail' || sectionNames?.has(entry.button.label) !== true}
      marker={entryZone !== zone || gap === null ? undefined : gap === index ? 'before' : gap === index + 1 && index === own.length - 1 ? 'after' : undefined}
      onContextMenu={onContextMenu(entry, entryZone)}
      onKeyDown={onKeyDown(entry, entryZone)}
      onDragStart={(event) => {
        const id = layout[entryZone].find((each) => each === entry.id)
        if (id === undefined) return
        event.dataTransfer?.setData(DRAG_TYPE, id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        startDrag(id, event.currentTarget)
      }}
      onDragEnd={endDrag}
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
        data-drop-zone={drag === null ? undefined : gap === null ? 'on' : 'over'}
        inert={zone !== 'header' && focusMode}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        value={pressed}
        // A press opens the view as its entry says (views.tsx): Runs at the newest Run, the others switch the main area. A
        // press on the pressed button opens its view again, as the View switch did.
        onValueChange={(next) => {
          const entry = viewButtonOf(next ?? view)
          if (entry !== undefined) void openView(entry, project, onViewChange)
        }}
      >
        {own.map(button(zone))}
        {own.length === 0 && drag !== null ? (
          <span className="w-view-zone__drop-here" data-drop-marker={gap === null ? undefined : 'here'} aria-hidden="true">
            Drop here
          </span>
        ) : null}
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
                onClick={() => place(moveToZone(startOf(layout), menu.id, target), menu.id)}
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
