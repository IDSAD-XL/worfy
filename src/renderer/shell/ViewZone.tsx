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
import type { ViewButtonId, ViewZone as Zone } from '../../shared/layout/view-buttons'
import { useFocusState } from '../focus/focus-state'
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

export function ViewZone({ zone, views, withRail = false, sectionNames }: ViewZoneProps) {
  const focusMode = useFocusState((state) => state.active)
  const { layout, view, project, onViewChange } = views
  const own = entriesOf(layout[zone])
  const guests = zone === 'header' && withRail ? entriesOf(layout.rail) : []
  const placed = [...own, ...guests]
  if (placed.length === 0) return null
  const pressed = placed.some((entry) => entry.id === view) ? view : null

  const button = (entryZone: Zone) => (entry: ViewButtonEntry) => (
    <ViewButton
      key={entry.id}
      entry={entry}
      look={zone}
      zone={entryZone}
      inactive={entry.button.needsProject !== undefined && project === undefined}
      badged={zone !== 'rail' || sectionNames?.has(entry.button.label) !== true}
    />
  )
  return (
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
  )
}
