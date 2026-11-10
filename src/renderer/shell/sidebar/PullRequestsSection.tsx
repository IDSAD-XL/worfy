import { useCallback, useEffect, useState } from 'react'
import { PR_INBOX_GROUP_TITLES, type PrInboxGroup } from '../../../shared/ipc/pr-inbox'
import type { ProjectView } from '../../../shared/ipc/projects'
import { readableReason } from '../../ipc'
import { openPrInboxOf } from '../../pr-inbox/open'
import { groupCounts, usePrInbox } from '../../pr-inbox/usePrInbox'
import { activeProject, useProjects } from '../../projects/useProjects'
import { SidebarSection } from '../SidebarSection'
import '../../pr-inbox/pr-inbox.css'

/**
 * The PR inbox of every Project of the window's Machine (worfy-pr-inbox ticket 03): a row per group that
 * holds a PR, with its count. A click opens the Pull requests view of that Project on that group. Under
 * the Pipeline section. A Project that reads no pull requests shows nothing.
 */
export const order = 27

interface ProjectPullsProps {
  project: ProjectView
  /** Says whether this Project shows anything (a group, or why its inbox could not be read), once it knows. */
  onShown: (projectId: string, shown: boolean) => void
  onOpen: (project: ProjectView, group: PrInboxGroup) => void
}

/** One Project's name and the counts of its groups; nothing while it has no PR. */
function ProjectPulls({ project, onShown, onOpen }: ProjectPullsProps) {
  const { snapshot, error } = usePrInbox(project.id)
  const counts = groupCounts(snapshot)
  const failed = snapshot === undefined && error !== undefined
  const known = failed || snapshot !== undefined
  const shown = failed || counts.length > 0
  useEffect(() => {
    if (known) onShown(project.id, shown)
  }, [known, shown, project.id, onShown])
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
  const projects = state?.projects ?? []
  const activeId = activeProject(state)?.id
  // Which Projects show anything, by id, once each knows: "No pull requests" needs all of them.
  const [shown, setShown] = useState<Readonly<Record<string, boolean>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const onShown = useCallback((projectId: string, value: boolean) => {
    setShown((current) => (current[projectId] === value ? current : { ...current, [projectId]: value }))
  }, [])

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
