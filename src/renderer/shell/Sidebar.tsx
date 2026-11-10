import { useId, useRef, type KeyboardEvent, type ReactElement } from 'react'
import { useFocusState } from '../focus/focus-state'
import { openSettings } from '../settings/settings-window'
import { SHORTCUTS } from '../../shared/shortcuts'
import { label } from '../shortcuts/match'
import { ProjectSwitcher } from './ProjectSwitcher'
import { collectExtensions, type ShellExtension } from './registry'
import { pickSection, showSidebarSection, useRailBadge, useSidebarScope } from './sidebar-scope'
import { SidebarToggle } from './sidebar-visibility'

// Each sidebar section is its own file, src/renderer/shell/sidebar/<Name>Section.tsx, with a
// default-exported component, `export const order = <number>` and, for its rail button, `railTitle`,
// `RailIcon` and `railEnd` (registry.ts). This file never changes when a section is added.
//
// The layout is variant C of the sidebar prototype (worfy-polish ticket 94): a strip as high as the
// toolbar with the room for the traffic lights, the button that hides the sidebar and the Project
// switcher; under it a rail with a button per section and the panel, which shows one section at a
// time. Every section stays mounted while another one is shown — it keeps what it read, and its badge
// on the rail stays current — and the ones not chosen are only hidden.
const sections = collectExtensions(import.meta.glob('./sidebar/*Section.tsx', { eager: true }))

export interface SidebarViewProps {
  sections: readonly ShellExtension[]
  /** The button that hides the sidebar, in the strip at the top; without it (a unit test) there is none. */
  onToggle?: () => void
}

/** The name of a section on the rail: its own, or the file name without "Section". */
const railTitle = (section: ShellExtension): string => section.rail?.title ?? section.id.replace(/Section$/, '')

function PlainIcon(): ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    </svg>
  )
}

function RailBadgeMark({ id }: { id: string }) {
  const badge = useRailBadge(id)
  if (badge === undefined) return null
  return badge.count === undefined ? (
    <span className="w-sidebar__rail-dot" data-tone={badge.tone} data-testid="sidebar-rail-badge" aria-hidden="true" />
  ) : (
    <span className="w-sidebar__rail-count w-mono" data-tone={badge.tone} data-testid="sidebar-rail-badge" aria-hidden="true">
      {badge.count > 99 ? '99+' : badge.count}
    </span>
  )
}

interface RailTabProps {
  section: ShellExtension
  selected: boolean
  /** The first of the sections at the foot of the rail (`railEnd`). */
  first: boolean
  tabId: string
  panelId: string
  onSelect: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

function RailTab({ section, selected, first, tabId, panelId, onSelect, onKeyDown }: RailTabProps) {
  const title = railTitle(section)
  const badge = useRailBadge(section.id)
  const Icon = section.rail?.Icon ?? PlainIcon
  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      className="w-sidebar__rail-button"
      aria-selected={selected}
      aria-controls={panelId}
      aria-label={title}
      // A screen reader hears the badge as the description of the tab; its name stays the section's.
      aria-description={badge?.label}
      title={badge === undefined ? title : `${title} — ${badge.label}`}
      tabIndex={selected ? 0 : -1}
      data-section-tab={section.id}
      // The first of the sections at the foot of the rail: the room above it pushes them down (shell.css).
      data-rail-foot={first ? '' : undefined}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <Icon />
      <RailBadgeMark id={section.id} />
    </button>
  )
}

const gearIcon = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </svg>
)

export function SidebarView({ sections, onToggle }: SidebarViewProps) {
  const base = useId()
  const saved = useSidebarScope((state) => state.section)
  // Focus mode has its own button for the sidebar in its bar (focus/FocusMode.tsx); one is enough.
  const focusMode = useFocusState((state) => state.active)
  const ordered = [...sections.filter((section) => !section.rail?.end), ...sections.filter((section) => section.rail?.end)]
  const active = pickSection(saved, ordered.map((section) => section.id))
  const rail = useRef<HTMLDivElement>(null)
  const tabId = (id: string) => `${base}-tab-${id}`
  const panelId = (id: string) => `${base}-panel-${id}`

  // The rail is one tab stop: ↑ and ↓ walk it and wrap round, Home and End go to its ends, and the
  // section under the focus is shown at once (the tabs pattern with automatic activation).
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = ordered.length - 1
    const next = event.key === 'ArrowDown' ? (index === last ? 0 : index + 1) : event.key === 'ArrowUp' ? (index === 0 ? last : index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
    if (next === null) return
    event.preventDefault()
    const section = ordered[next]
    if (section === undefined) return
    showSidebarSection(section.id)
    rail.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  const top = ordered.filter((section) => !section.rail?.end)
  const tab = (section: ShellExtension, index: number) => (
    <RailTab
      key={section.id}
      section={section}
      selected={section.id === active}
      first={index === top.length}
      tabId={tabId(section.id)}
      panelId={panelId(section.id)}
      onSelect={() => showSidebarSection(section.id)}
      onKeyDown={onKeyDown(index)}
    />
  )
  return (
    <nav aria-label="Sidebar" className="w-sidebar">
      {/* Room for the native traffic lights; dragging here moves the window. Its controls do not drag. */}
      <div className="w-sidebar__titlebar">
        {onToggle !== undefined && !focusMode ? <SidebarToggle className="w-sidebar__icon-button" visible onToggle={onToggle} /> : null}
        <span className="w-sidebar__titlebar-gap" />
        <ProjectSwitcher />
      </div>
      <div className="w-sidebar__body">
        <div className="w-sidebar__rail">
          {/* Only the tabs are in the tablist: Settings opens a dialog, not a section. */}
          <div ref={rail} role="tablist" aria-label="Sidebar sections" aria-orientation="vertical" className="w-sidebar__tabs">
            {ordered.map(tab)}
          </div>
          <button type="button" className="w-sidebar__rail-button" aria-label="Settings" title={`Settings (${label(SHORTCUTS.settings)})`} onClick={() => openSettings()}>
            {gearIcon}
          </button>
        </div>
        <div className="w-sidebar__sections">
          {ordered.map(({ id, Component }) => (
            <div key={id} className="w-sidebar__section" data-section={id} role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={id !== active}>
              <Component />
            </div>
          ))}
        </div>
      </div>
    </nav>
  )
}

export function Sidebar({ onToggle }: { onToggle?: () => void }) {
  return <SidebarView sections={sections} onToggle={onToggle} />
}
