import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { worstLevel, type HealthLevel } from '../../shared/health/severity'
import type { Check, FirstRunReport } from '../../shared/ipc/first-run'
import { SHORTCUTS } from '../../shared/shortcuts'
import { useFocusState } from '../focus/focus-state'
import { hasPreloadBridge, invoke, showSubscribeError, subscribe } from '../ipc'
import { openHealthCheck, openSettings } from '../settings/settings-window'
import { label } from '../shortcuts/match'
import { Tooltip } from '../theme/kit/Tooltip'
import { ErrorBoundary } from './ErrorBoundary'
import { useFirstRun } from './first-run-store'
import { ProjectSwitcher } from './ProjectSwitcher'
import { collectExtensions, type ShellExtension } from './registry'
import { pickSection, showSidebarSection, useRailBadge, useSidebarScope } from './sidebar-scope'
import { SidebarResizeHandle } from './SidebarResizeHandle'
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
  /** The edge that changes the sidebar's width (worfy-polish ticket 158); without it (a unit test) there is none. */
  resizable?: boolean
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
    <Tooltip label={badge === undefined ? title : `${title} — ${badge.label}`} side="right">
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-description is ARIA 1.3, which Chromium reads; the plugin's list stops at 1.2. */}
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
    </Tooltip>
  )
}

/**
 * The Health check report as main keeps it (worfy-auth-check ticket 03): the last one at mount
 * (`firstRun.health`, which checks nothing), then every change main sends. A report heard from the
 * event is newer than the answer to the first call, so that answer is dropped then. Without the
 * preload bridge (a unit test that sets none) there is no report.
 */
function useHealthReport(): FirstRunReport | null {
  const [report, setReport] = useState<FirstRunReport | null>(null)
  useEffect(() => {
    if (!hasPreloadBridge()) return undefined
    let live = true
    let heard = false
    let stop = (): void => undefined
    try {
      stop = subscribe('firstRun.reportChanged', (next) => {
        heard = true
        setReport(next)
      })
    } catch (error) {
      showSubscribeError('firstRun.reportChanged', error)
    }
    void invoke('firstRun.health').then((result) => {
      if (live && !heard && result.ok) setReport(result.value)
    })
    return () => {
      live = false
      stop()
    }
  }, [])
  return report
}

/** A row's name in the tooltip: with its Project, for a row of the Projects group. */
const rowName = (check: Check): string => (check.project === undefined ? check.title : `${check.title} (${check.project.name})`)

/** At most three names, then how many more. */
function names(rows: readonly Check[]): string {
  const shown = rows.slice(0, 3).map(rowName).join(', ')
  return rows.length > 3 ? `${shown} and ${rows.length - 3} more` : shown
}

/**
 * Why the dot of the Health check button is what it is (spec, the icon's colour): the critical rows
 * that are not `ok`, the other rows that are not, and each row that could not be checked as
 * "Couldn't check: <reason>" — such a row never counts as critical (Q2).
 */
function healthReason(report: FirstRunReport | null, level: HealthLevel): string {
  if (level === 'pending') return report === null ? 'not checked yet' : 'checking…'
  if (level === 'ok' || report === null) return 'everything works'
  const open = report.checks.filter((check) => check.status !== 'ok' && check.status !== 'unknown')
  const critical = open.filter((check) => check.severity === 'critical')
  const other = open.filter((check) => check.severity !== 'critical')
  const unknown = report.checks.filter((check) => check.status === 'unknown')
  return [
    critical.length > 0 ? `critical: ${names(critical)}` : null,
    other.length > 0 ? `non-critical: ${names(other)}` : null,
    ...unknown.map((check) => `Couldn't check: ${check.detail === '' ? 'no answer' : check.detail} (${rowName(check)})`),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/** The dot of each level, in the look of a rail badge (RailBadgeMark): red, yellow, none, a grey ring. */
const HEALTH_TONE: Record<HealthLevel, string | null> = { critical: 'critical', 'non-critical': 'warning', ok: null, pending: 'pending' }

const healthIcon = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* A heart with a pulse line through it: the health of the Machine, not a section of the sidebar. */}
    <path d="M8 13.5C4.5 11.2 2 8.9 2 6.1A3 3 0 0 1 8 4.6A3 3 0 0 1 14 6.1C14 8.9 11.5 11.2 8 13.5Z" />
    <path d="M3.2 8.2H6L7 6.6L8.6 9.6L9.6 8.2H12.8" />
  </svg>
)

/**
 * The Health check button of the rail (worfy-auth-check ticket 04; spec, the solution, point 3): above
 * the sections of the foot, always there. Not a tab — it shows nothing in the sidebar and opens
 * Settings → Health. Its dot is the worst level of the report of this Machine and every open Project
 * (Q3, Q4): red — a critical row is not `ok`; yellow — only non-critical rows are not; none — every row
 * is; a grey ring — no report yet, or "Check again" runs. It runs no check itself and shows no toast (Q9).
 */
export function HealthRailButton() {
  const report = useHealthReport()
  const checking = useFirstRun((state) => state.checking)
  const level = worstLevel(report, checking)
  const reason = healthReason(report, level)
  const tone = HEALTH_TONE[level]
  return (
    <Tooltip label={`Health check — ${reason}`} side="right">
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-description is ARIA 1.3, which Chromium reads; the plugin's list stops at 1.2. */}
      <button
        type="button"
        className="w-sidebar__rail-button w-sidebar__health"
        aria-label="Health check"
        aria-description={reason}
        data-health={level}
        onClick={openHealthCheck}
      >
        {healthIcon}
        {tone === null ? null : <span className="w-sidebar__rail-dot" data-tone={tone} data-testid="health-rail-dot" aria-hidden="true" />}
      </button>
    </Tooltip>
  )
}

const gearIcon = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* A gear with eight teeth: the earlier rays read as a sun, that is, a theme switch (owner, 2026-11-15). */}
    <path d="M7.01 3.2L7.17 1.45L8.83 1.45L8.99 3.2A4.9 4.9 0 0 1 10.69 3.9L12.05 2.78L13.22 3.95L12.1 5.31A4.9 4.9 0 0 1 12.8 7.01L14.55 7.17L14.55 8.83L12.8 8.99A4.9 4.9 0 0 1 12.1 10.69L13.22 12.05L12.05 13.22L10.69 12.1A4.9 4.9 0 0 1 8.99 12.8L8.83 14.55L7.17 14.55L7.01 12.8A4.9 4.9 0 0 1 5.31 12.1L3.95 13.22L2.78 12.05L3.9 10.69A4.9 4.9 0 0 1 3.2 8.99L1.45 8.83L1.45 7.17L3.2 7.01A4.9 4.9 0 0 1 3.9 5.31L2.78 3.95L3.95 2.78L5.31 3.9A4.9 4.9 0 0 1 7.01 3.2Z" />
    <circle cx="8" cy="8" r="2.1" />
  </svg>
)

export function SidebarView({ sections, onToggle, resizable = false }: SidebarViewProps) {
  const base = useId()
  const saved = useSidebarScope((state) => state.section)
  // Focus mode has its own button for the sidebar in its bar (focus/FocusMode.tsx); one is enough.
  const focusMode = useFocusState((state) => state.active)
  const ordered = [...sections.filter((section) => !section.rail?.end), ...sections.filter((section) => section.rail?.end)]
  const active = pickSection(
    saved,
    ordered.map((section) => section.id),
    ordered.filter((section) => section.rail?.start !== false).map((section) => section.id),
  )
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
      {/* Room for the native traffic lights, the wordmark and, at the right edge, the button that hides the sidebar
          (the owner's layout, 2026-11-10). Dragging here moves the window; the button does not drag. */}
      <div className="w-sidebar__titlebar">
        <span className="w-sidebar__wordmark" data-testid="sidebar-wordmark">
          worfy
        </span>
        <span className="w-sidebar__titlebar-gap" />
        {onToggle !== undefined && !focusMode ? <SidebarToggle className="w-sidebar__icon-button" visible onToggle={onToggle} /> : null}
      </div>
      {/* The Project switcher across the whole sidebar, under the strip: a long Project name has room. */}
      <div className="w-sidebar__switcher">
        <ProjectSwitcher />
      </div>
      <div className="w-sidebar__body">
        <div className="w-sidebar__rail">
          {/* Only the tabs are in the tablist: Settings and Health check open a dialog, not a section. The
              tablist lays out no box of its own (shell.css), so Health check, after it here, is drawn
              above the sections of the foot, and the rail stays one tablist with one Tab stop. */}
          <div ref={rail} role="tablist" aria-label="Sidebar sections" aria-orientation="vertical" className="w-sidebar__tabs">
            {ordered.map(tab)}
          </div>
          <HealthRailButton />
          <Tooltip label={`Settings (${label(SHORTCUTS.settings)})`} side="right">
            <button type="button" className="w-sidebar__rail-button" aria-label="Settings" onClick={() => openSettings()}>
              {gearIcon}
            </button>
          </Tooltip>
        </div>
        <div className="w-sidebar__sections">
          {ordered.map(({ id, Component }) => (
            <div key={id} className="w-sidebar__section" data-section={id} role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={id !== active}>
              {/* A throw inside one section stays in it: the rail and the other sections keep working (worfy-polish 163). */}
              <ErrorBoundary scope="section" name={id}>
                <Component />
              </ErrorBoundary>
            </div>
          ))}
        </div>
      </div>
      {/* Last in the sidebar: its right edge, over the border, drawn above the panel. */}
      {resizable ? <SidebarResizeHandle /> : null}
    </nav>
  )
}

export function Sidebar({ onToggle }: { onToggle?: () => void }) {
  return <SidebarView sections={sections} onToggle={onToggle} resizable />
}
