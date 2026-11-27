// One View button in the look of the place it is drawn in (worfy-layout ticket 04; spec, the section on one button in
// three looks): a segment of the header's group with its icon, label and badge; a square of the rail, 34 × 34 px with an 18 px
// icon, the «window» mark in the corner of the icon and the tooltip on the right; a footer button 22 px high with a
// 13 px icon, its label and badge. Its name, tooltip, icon, badge and why it is inactive come from the registry
// (views.tsx). It is a button of a kit ToggleGroup (ViewZone.tsx): the group knows which one is pressed, and the zone
// gives it its menu and its keys (worfy-layout ticket 05) and its drag (ticket 06): every button is draggable, an inactive
// one too, as the layout does not depend on the Project.
import type { DragEventHandler, KeyboardEventHandler, MouseEventHandler } from 'react'
import type { ViewZone } from '../../shared/layout/view-buttons'
import { ToggleGroupItem } from '../theme/kit/ToggleGroup'
import { Tooltip } from '../theme/kit/Tooltip'
import type { RailBadge } from './sidebar-scope'
import type { ViewButtonEntry } from './views'

/** The look a View button takes: that of the zone it is drawn in. */
export type ViewButtonLook = ViewZone

export interface ViewButtonProps {
  entry: ViewButtonEntry
  look: ViewButtonLook
  /** The zone the layout puts it in: the rail's buttons are drawn in the header while the sidebar is hidden. */
  zone: ViewZone
  /** Without the open Project a view that shows one has nothing to show: the button is inactive. */
  inactive: boolean
  /**
   * Whether it shows its badge. On the rail it does not while the section of the same name stands there with its own
   * (owner's decision B, 2026-11-25): two equal counts side by side would read as two things.
   */
  badged: boolean
  /** A right click, a click with two fingers on a touchpad or the menu key: the zone opens the button's menu. */
  onContextMenu?: MouseEventHandler<HTMLButtonElement>
  /** Shift+F10 and the ⌥-arrows: the zone opens the menu or moves the button, before the group's own arrows. */
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>
  /** While a drag goes, the marker of the gap the pointer is over: before this button, or after it as the zone's last. */
  marker?: 'before' | 'after'
  /** The start and the end of a drag of this button (worfy-layout ticket 06): the zone keeps the drag. */
  onDragStart?: DragEventHandler<HTMLButtonElement>
  onDragEnd?: DragEventHandler<HTMLButtonElement>
}

function Badge({ badge, look, testId }: { badge: RailBadge; look: ViewButtonLook; testId: string }) {
  if (look === 'rail') {
    // The look of a section's badge on the rail (Sidebar.tsx, RailBadgeMark).
    return badge.count === undefined ? (
      <span className="w-sidebar__rail-dot" data-tone={badge.tone} data-testid={testId} aria-hidden="true" />
    ) : (
      <span className="w-sidebar__rail-count w-mono" data-tone={badge.tone} data-testid={testId} aria-hidden="true">
        {badge.count > 99 ? '99+' : badge.count}
      </span>
    )
  }
  return badge.count === undefined ? (
    <span className="w-view-badge w-view-badge--dot" data-tone={badge.tone} data-testid={testId} aria-hidden="true" />
  ) : (
    <span className="w-view-badge w-mono" data-tone={badge.tone} data-testid={testId} aria-hidden="true">
      {badge.count > 99 ? '99+' : badge.count}
    </span>
  )
}

/** The mark in the corner of a rail button's icon: the view opens in the main area, not as a panel of the sidebar. */
function WindowMark() {
  return (
    <span className="w-view-button__window" data-testid="view-button-window" aria-hidden="true">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="0.6" y="0.6" width="7.8" height="7.8" rx="1.6" />
        <path d="M0.6 3.1h7.8" />
      </svg>
    </span>
  )
}

const CLASSES: Record<ViewButtonLook, string> = {
  header: 'w-segmented__item w-view-button',
  rail: 'w-sidebar__rail-button w-view-button w-view-button--rail',
  footer: 'w-view-button w-view-button--footer',
}

export function ViewButton({ entry, look, zone, inactive, badged, onContextMenu, onKeyDown, marker, onDragStart, onDragEnd }: ViewButtonProps) {
  const { button } = entry
  // Every button reads its badge, shown or not: a hook is called on every render.
  const read = button.useBadge()
  const badge = badged ? read : undefined
  const { Icon } = button
  const tooltip = inactive ? (button.needsProject ?? button.title) : button.title
  const testId = button.testId === undefined ? 'view-button-badge' : `${button.testId}-count`
  const item = (
    <ToggleGroupItem
      value={entry.id}
      className={CLASSES[look]}
      aria-label={button.label}
      // A screen reader hears the badge as the description; the name stays the view's. Without a badge no key at all:
      // on the rail the kit Tooltip gives the description then, and an own key, even undefined, would take its place.
      {...(badge === undefined ? {} : { 'aria-description': badge.label })}
      // The native tooltip in the header and the footer, as the View switch had it; on the rail the kit's, on the right,
      // but for an inactive button: a disabled button takes no pointer, and only the native tooltip still shows there.
      title={look === 'rail' && !inactive ? undefined : tooltip}
      disabled={inactive}
      data-view-button={entry.id}
      data-zone={zone}
      data-testid={button.testId}
      data-drop-marker={marker}
      draggable
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <Icon />
      {look === 'rail' ? <WindowMark /> : <span className={look === 'header' ? 'w-segmented__label' : 'w-view-button__label'}>{button.label}</span>}
      {badge === undefined ? null : <Badge badge={badge} look={look} testId={testId} />}
    </ToggleGroupItem>
  )
  if (look !== 'rail' || inactive) return item
  return (
    <Tooltip label={badge === undefined ? tooltip : `${tooltip} — ${badge.label}`} side="right">
      {item}
    </Tooltip>
  )
}
