import { useCallback, useEffect, useState } from 'react'
import { PR_INBOX_GROUP_TITLES, type PrInboxGroup } from '../../../shared/ipc/pr-inbox'
import type { ProjectView } from '../../../shared/ipc/projects'
import { readableReason } from '../../ipc'
import { openPrInboxOf } from '../../pr-inbox/open'
import { groupCounts, usePrInbox } from '../../pr-inbox/usePrInbox'
import { activeProject, useProjects } from '../../projects/useProjects'
import { projectsInScope, setRailBadge, useSidebarScope } from '../sidebar-scope'
import { SidebarSection } from '../SidebarSection'
import '../../pr-inbox/pr-inbox.css'

/**
 * The PR inbox of the Projects of the window's Machine the Project switcher shows (all, or the open
 * one; sidebar-scope.ts; worfy-pr-inbox ticket 03): a row per group that holds a PR, with its count. A
 * click opens the Pull requests view of that Project on that group. A Project that reads no pull
 * requests shows nothing. Its rail button counts the pull requests that need you.
 */
export const order = 14
export const railTitle = 'Pull requests'

export function RailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="12.5" r="1.5" />
      <path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
    </svg>
  )
}

/** The groups whose pull requests wait for you: they make the count on the rail button. */
const NEED_YOU: ReadonlySet<PrInboxGroup> = new Set<PrInboxGroup>(['needs-review', 'needs-answer', 'needs-fix'])

interface ProjectPullsProps {
  project: ProjectView
  /**
   * Says whether this Project shows anything (a group, or why its inbox could not be read), once it
   * knows, and how many of its pull requests need you.
   */
  onShown: (projectId: string, shown: boolean, needYou: number) => void
  onOpen: (project: ProjectView, group: PrInboxGroup) => void
}

/** One Project's name and the counts of its groups; nothing while it has no PR. */
function ProjectPulls({ project, onShown, onOpen }: ProjectPullsProps) {
  const { snapshot, error } = usePrInbox(project.id)
  const counts = groupCounts(snapshot)
  const failed = snapshot === undefined && error !== undefined
  const known = failed || snapshot !== undefined
  const shown = failed || counts.length > 0
  const needYou = counts.reduce((sum, { group, count }) => sum + (NEED_YOU.has(group) ? count : 0), 0)
  useEffect(() => {
    if (known) onShown(project.id, shown, needYou)
  }, [known, shown, needYou, project.id, onShown])
  if (!shown) return null
  return (
    <li>
      <div className="w-pr-inbox-section__project" title={project.path}>
        {project.name}
      </div>
      {failed ? (
        <p className="w-pr-inbox-section__message w-pr-inbox-section__message--error">Pull requests could not be read: {readableReason(error)}</p>
      ) : (
        <ul className="w-pr-inbox-section__list">
          {counts.map(({ group, count }) => (
            <li key={group}>
              <button
                type="button"
                className="w-row w-pr-inbox-section__row"
                data-testid="pr-inbox-section-row"
                data-project={project.id}
                data-group={group}
                title={`${PR_INBOX_GROUP_TITLES[group]}: ${count}`}
                onClick={() => onOpen(project, group)}
              >
                <span className="w-pr-inbox-section__label">{PR_INBOX_GROUP_TITLES[group]}</span>
                <span className="w-pr-inbox-section__count w-mono" data-testid="pr-inbox-section-count">
                  {count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function PullRequestsSection() {
  const state = useProjects()
  const activeId = activeProject(state)?.id
  const projects = projectsInScope(state?.projects ?? [], useSidebarScope((store) => store.scope), activeId)
  // Which Projects show anything, by id, once each knows: "No pull requests" needs all of them.
  const [shown, setShown] = useState<Readonly<Record<string, boolean>>>({})
  const [needing, setNeeding] = useState<Readonly<Record<string, number>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const onShown = useCallback((projectId: string, value: boolean, needYou: number) => {
    setShown((current) => (current[projectId] === value ? current : { ...current, [projectId]: value }))
    setNeeding((current) => (current[projectId] === needYou ? current : { ...current, [projectId]: needYou }))
  }, [])
  const needYou = projects.reduce((sum, project) => sum + (needing[project.id] ?? 0), 0)
  useEffect(() => {
    setRailBadge('PullRequestsSection', needYou > 0 ? { tone: 'blocked', count: needYou, label: needYou === 1 ? '1 pull request needs you' : `${needYou} pull requests need you` } : undefined)
    return () => setRailBadge('PullRequestsSection', undefined)
  }, [needYou])

  const onOpen = (project: ProjectView, group: PrInboxGroup) => {
    setFailure(null)
    void openPrInboxOf(project.id, activeId, undefined, group).then((refused) => {
      if (refused !== undefined) setFailure(`${project.name} could not be opened: ${readableReason(refused)}`)
    })
  }

  const nothing = state !== undefined && projects.every((project) => shown[project.id] === false)
  return (
    <SidebarSection
      id="PullRequestsSection"
      title="Pull requests"
      scope="filtered"
      notice={failure === null ? null : <p className="w-pr-inbox-section__message w-pr-inbox-section__message--error">{failure}</p>}
    >
      <ul className="w-pr-inbox-section__list">
        {projects.map((project) => (
          <ProjectPulls key={project.id} project={project} onShown={onShown} onOpen={onOpen} />
        ))}
      </ul>
      {nothing ? (
        <p className="w-pr-inbox-section__message" data-testid="pr-inbox-section-empty">
          No pull requests
        </p>
      ) : null}
    </SidebarSection>
  )
}
