import { useCallback, useEffect, useState } from 'react'
import type { ProjectView } from '../../../shared/ipc/projects'
import { readableReason } from '../../ipc'
import { useNow } from '../../limits/useLimits'
import { inWork, stuckLine, ticketKeyOf, ticketRef, titlesOf, waitsText } from '../../pipeline/board'
import { openPipelineOf } from '../../pipeline/open'
import { usePipeline } from '../../pipeline/usePipeline'
import { activeProject, useProjects } from '../../projects/useProjects'
import { StatusChip } from '../../theme/primitives'
import { useWorkflow } from '../../workflow/useWorkflow'
import { SidebarSection } from '../SidebarSection'
import '../../pipeline/pipeline.css'

/**
 * The Tickets in work of every Project of the window's Machine — neither Queued nor Done — with the
 * Stage they stand on and who they wait for (worfy-pipeline ticket 04). A click opens the Pipeline
 * board of that Project. Under the Epics of the active Project.
 */
export const order = 25

/** A row of two lines, as in the Epics section: 5 px of padding, 16, a gap of 4, 18 and 5 px. */
const ROW_HEIGHT = 48

interface ProjectInWorkProps {
  project: ProjectView
  /** Says whether this Project shows anything (a row, or why its Pipeline could not be read), once it knows. */
  onShown: (projectId: string, shown: boolean) => void
  onOpen: (project: ProjectView) => void
}

/** One Project's name and its Tickets in work; nothing while it has none. */
function ProjectInWork({ project, onShown, onOpen }: ProjectInWorkProps) {
  const { snapshot, error } = usePipeline(project.path)
  const { model } = useWorkflow(project.path)
  const now = useNow()
  const tickets = snapshot?.tickets.filter(inWork) ?? []
  const known = error !== undefined || snapshot !== undefined
  const shown = error !== undefined || tickets.length > 0
  useEffect(() => {
    if (known) onShown(project.id, shown)
  }, [known, shown, project.id, onShown])
  if (!shown) return null

  const titles = titlesOf(model)
  const columns = new Map(snapshot?.pipeline.map((column) => [column.id, column]))
  return (
    <li>
      <div className="w-pipeline-section__project" title={project.path}>
        {project.name}
      </div>
      {error !== undefined ? (
        <p className="w-pipeline-section__message">The Pipeline could not be read: {readableReason(error)}</p>
      ) : (
        <ul className="w-pipeline-section__list">
          {tickets.map((ticket) => {
            const title = titles[ticketKeyOf(ticket)]
            const column = columns.get(ticket.stage)
            const stage = column?.title ?? ticket.stage
            const stuck = stuckLine(column, ticket, now)
            return (
              <li key={ticketKeyOf(ticket)}>
                <button
                  type="button"
                  className="w-row w-pipeline-row"
                  data-testid="pipeline-row"
                  data-project={project.id}
                  data-epic={ticket.epic}
                  data-ticket={ticket.num}
                  data-stuck={stuck === null ? undefined : 'true'}
                  title={[`${ticketRef(ticket)}${title === undefined ? '' : ` — ${title}`}`, stage, ticket.blocked?.reason ? `Blocked: ${ticket.blocked.reason}` : null, stuck].filter(Boolean).join('\n')}
                  onClick={() => onOpen(project)}
                >
                  <span className="w-pipeline-row__line">
                    <span className="w-pipeline-row__ref w-mono" data-testid="pipeline-ref">
                      {ticketRef(ticket)}
                    </span>
                    {title !== undefined ? <span className="w-pipeline-row__title">{title}</span> : null}
                  </span>
                  <span className="w-pipeline-row__line">
                    <span className="w-pipeline-row__stage" data-testid="pipeline-stage">
                      <StatusChip status={ticket.blocked === null ? 'working' : 'blocked'} label={stage} />
                    </span>
                    {ticket.waits !== null ? (
                      <span className="w-pipeline-row__waits" data-testid="pipeline-waits">
                        {waitsText(ticket.waits)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

export default function PipelineSection() {
  const state = useProjects()
  const projects = state?.projects ?? []
  const activeId = activeProject(state)?.id
  // Which Projects show anything, by id, once each knows: "Nothing in work" needs all of them.
  const [shown, setShown] = useState<Readonly<Record<string, boolean>>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const onShown = useCallback((projectId: string, value: boolean) => {
    setShown((current) => (current[projectId] === value ? current : { ...current, [projectId]: value }))
  }, [])

  const onOpen = (project: ProjectView) => {
    setFailure(null)
    void openPipelineOf(project.id, activeId).then((refused) => {
      if (refused !== undefined) setFailure(`${project.name} could not be opened: ${readableReason(refused)}`)
    })
  }

  const nothing = state !== undefined && projects.every((project) => shown[project.id] === false)
  return (
    <SidebarSection
      id="PipelineSection"
      title="Pipeline"
      rowHeight={ROW_HEIGHT}
      notice={failure === null ? null : <p className="w-pipeline-section__message w-pipeline-section__message--error">{failure}</p>}
    >
      <ul className="w-pipeline-section__list">
        {projects.map((project) => (
          <ProjectInWork key={project.id} project={project} onShown={onShown} onOpen={onOpen} />
        ))}
      </ul>
      {nothing ? <p className="w-pipeline-section__message">Nothing in work</p> : null}
    </SidebarSection>
  )
}
