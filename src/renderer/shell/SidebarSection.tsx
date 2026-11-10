import { useId, type ReactNode } from 'react'
import { activeProject, useProjects } from '../projects/useProjects'
import { ALL_PROJECTS, useSidebarScope } from './sidebar-scope'
import './sidebar-section.css'

export interface SidebarSectionProps {
  /** The section's id: the name of its file without the extension (`EpicsSection`), as ShellExtension.id. */
  id: string
  /** The text of the heading, and the name of the region. */
  title: string
  /**
   * Which Projects the section shows, said next to the heading (worfy-polish ticket 94, sidebar-scope.ts):
   * - `filtered` — the section follows the Project switcher: «All Projects», or the name of the one;
   * - `current` — it shows the open Project in either answer: its name, and while «All» is chosen
   *   with more than one Project a line that says the list is of the open Project alone.
   * Without it (Projects, Machines) nothing is said.
   */
  scope?: 'filtered' | 'current'
  /** Shown right after the heading: a count. */
  meta?: ReactNode
  /** Shown at the right edge of the header: the section's own buttons. */
  trailing?: ReactNode
  /**
   * The section's main buttons, in a row of their own under the header and above the list, outside the
   * part that scrolls (Sessions: New session, Product Session, as in the sidebar prototype).
   */
  actions?: ReactNode
  /** A message about an action of the header, above the list. */
  notice?: ReactNode
  /** Popovers, menus and dialogs of the section, placed against it under its header. */
  overlay?: ReactNode
  testId?: string
  /** The body: the list, with whatever belongs under it. It takes the height of the panel left and scrolls by itself. */
  children?: ReactNode
}

function ScopeLabel({ kind }: { kind: 'filtered' | 'current' }) {
  const state = useProjects()
  const scope = useSidebarScope((store) => store.scope)
  const active = activeProject(state)
  const one = scope === 'project' && active !== undefined
  const text = kind === 'filtered' && !one ? ALL_PROJECTS : active?.name
  if (text === undefined) return null
  return (
    <span className="w-sidebar-section__scope" data-testid="sidebar-scope-label" title={text}>
      {text}
    </span>
  )
}

/** The line of a `current` section while «All» is chosen and the Machine has more than one Project. */
function ScopeNote() {
  const state = useProjects()
  const scope = useSidebarScope((store) => store.scope)
  const active = activeProject(state)
  if (scope !== 'all' || active === undefined || (state?.projects.length ?? 0) < 2) return null
  return (
    <p className="w-sidebar-section__scope-note" data-testid="sidebar-scope-note">
      {active.name} only: this list does not show other Projects.
    </p>
  )
}

/**
 * The frame every sidebar section is drawn in, in the panel of the sidebar (Sidebar.tsx): a region
 * named by its heading, the header with the Projects it shows, its count and its buttons, and the
 * body under it, which scrolls.
 */
export function SidebarSection({ id, title, scope, meta, trailing, actions, notice, overlay, testId, children }: SidebarSectionProps) {
  const headingId = useId()
  // Marked for sidebar-section.css: a notice takes its own height above the list.
  const hasNotice = notice !== undefined && notice !== null && notice !== false

  return (
    <section className="w-sidebar-section" aria-labelledby={headingId} data-section-id={id} data-notice={hasNotice ? 'true' : undefined} data-testid={testId}>
      <div className="w-sidebar-section__header">
        <h2 id={headingId} className="w-sidebar-section__heading">
          {title}
        </h2>
        {scope !== undefined ? <ScopeLabel kind={scope} /> : null}
        {meta !== undefined && meta !== null ? <span className="w-sidebar-section__meta">{meta}</span> : null}
        {trailing !== undefined && trailing !== null ? <span className="w-sidebar-section__trailing">{trailing}</span> : null}
      </div>
      {scope === 'current' ? <ScopeNote /> : null}
      {actions !== undefined && actions !== null ? <div className="w-sidebar-section__actions">{actions}</div> : null}
      <div className="w-sidebar-section__notice">{notice}</div>
      {/* No height of its own: a popover placed against the section starts here, under the header and the actions. */}
      <div className="w-sidebar-section__overlay">{overlay}</div>
      <div className="w-sidebar-section__body">{children}</div>
    </section>
  )
}
