import { useEffect } from 'react'
import type { AcceptanceGroupName, AcceptanceRow, AcceptanceState } from '../../../shared/ipc/acceptance'
import type { OwnerCheckVerdict } from '../../../shared/projects/action-templates'
import { openAcceptance } from '../../acceptance/open'
import { GROUP_TITLES, useAcceptance, waitsForOwner } from '../../acceptance/useAcceptance'
import { activeProject, useProjects } from '../../projects/useProjects'
import { projectsInScope, setRailBadge, useSidebarScope } from '../sidebar-scope'
import { SidebarSection } from '../SidebarSection'
import '../../pr-inbox/pr-inbox.css'

/**
 * The Acceptance queue by Project (worfy-acceptance ticket 06), for the Projects of the window's Machine the Project
 * switcher shows (all, or the open one; sidebar-scope.ts): a Project's name, then a row per group that waits for the
 * owner and holds a row of it, with its count. In work and Older are left out: they wait for no one now, and the view
 * keeps them closed too. A click opens the Acceptance view on that Project's first row of that group; the view is over
 * every Project, so no Project is opened. Its rail button counts Ready to check. The queue is the one the toolbar tab
 * and the view read (acceptance/useAcceptance.ts): main's, nothing of its own.
 */
export const order = 15
export const railTitle = 'Acceptance'

export function RailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5.5 8.2l1.8 1.8 3.4-3.8" />
    </svg>
  )
}

/** The groups the section counts, in the view's order. */
const COUNTED: readonly AcceptanceGroupName[] = ['ready', 'update', 'waits', 'failed']

/** One Project's counted groups, each with its first row (the one a click selects) and its count. */
interface ProjectCounts {
  projectId: string
  groups: { group: AcceptanceGroupName; first: AcceptanceRow; count: number }[]
}

/**
 * The counted groups of each Project of `projectIds`, in that order; a Project without one is left out. Ready to check
 * leaves out the items already Sent, as the tab's count does (readyCount): they wait for the line, not for the owner;
 * one whose decision was not recorded in time counts again.
 */
function countsByProject(state: AcceptanceState | null, sentHere: Readonly<Record<string, OwnerCheckVerdict>>, projectIds: readonly string[]): ProjectCounts[] {
  const groups = state?.groups ?? []
  const counts = (group: AcceptanceGroupName, row: AcceptanceRow): boolean => group !== 'ready' || waitsForOwner(row, sentHere)
  return projectIds.flatMap((projectId) => {
    const counted = COUNTED.flatMap((group) => {
      const rows = groups.find((each) => each.group === group)?.rows.filter((row) => row.ticket.projectId === projectId && counts(group, row)) ?? []
      return rows.length === 0 ? [] : [{ group, first: rows[0]!, count: rows.length }]
    })
    return counted.length === 0 ? [] : [{ projectId, groups: counted }]
  })
}

const badgeLabel = (count: number): string => (count === 1 ? '1 check ready to check' : `${count} checks ready to check`)

export default function AcceptanceSection() {
  const { state, error, sentHere } = useAcceptance()
  const projectsState = useProjects()
  const projects = projectsInScope(projectsState?.projects ?? [], useSidebarScope((store) => store.scope), activeProject(projectsState)?.id)
  const counts = countsByProject(state, sentHere, projects.map((project) => project.id))
  const ready = counts.reduce((sum, each) => sum + (each.groups.find((group) => group.group === 'ready')?.count ?? 0), 0)
  useEffect(() => {
    setRailBadge('AcceptanceSection', ready > 0 ? { tone: 'working', count: ready, label: badgeLabel(ready) } : undefined)
    return () => setRailBadge('AcceptanceSection', undefined)
  }, [ready])

  const failed = state === null && error !== null
  return (
    <SidebarSection id="AcceptanceSection" title="Acceptance" scope="filtered">
      {failed ? (
        <p className="w-pr-inbox-section__message w-pr-inbox-section__message--error" data-testid="acceptance-section-error">
          Acceptance could not be read: {error}
        </p>
      ) : null}
      <ul className="w-pr-inbox-section__list">
        {counts.map(({ projectId, groups }) => {
          const project = projects.find((each) => each.id === projectId)
          return (
            <li key={projectId}>
              <div className="w-pr-inbox-section__project" title={project?.path} data-testid="acceptance-section-project">
                {project?.name ?? projectId}
              </div>
              <ul className="w-pr-inbox-section__list">
                {groups.map(({ group, first, count }) => (
                  <li key={group}>
                    <button
                      type="button"
                      className="w-row w-pr-inbox-section__row"
                      data-testid="acceptance-section-row"
                      data-project={projectId}
                      data-group={group}
                      title={`${GROUP_TITLES[group]}: ${count}`}
                      onClick={() => openAcceptance({ projectId, epic: first.ticket.epic, num: first.ticket.num, ...(first.kind === 'item' ? { item: first.item.index } : {}) })}
                    >
                      <span className="w-pr-inbox-section__label">{GROUP_TITLES[group]}</span>
                      <span className="w-pr-inbox-section__count w-mono">{count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
      {state !== null && counts.length === 0 ? (
        <p className="w-pr-inbox-section__message" data-testid="acceptance-section-empty">
          Nothing to check
        </p>
      ) : null}
    </SidebarSection>
  )
}
