// The Pipeline view: the board of the active Project (worfy-pipeline ticket 04, ADR-0067). A column
// per Stage of the Project's Pipeline, in its order and with the Profile's names; a card per Ticket
// on the Stage it stands on. The Stages are computed in main and come as a snapshot of the `pipeline`
// domain (usePipeline.ts); the board keeps none of them past the window (ADR-0002). It follows
// `pipeline.changed` by itself, so there is no button to read it again.
import { useState, type CSSProperties } from 'react'
import type { PipelineColumn, PipelineSnapshot, PipelineTicket } from '../../shared/ipc/pipeline'
import type { ProjectView } from '../../shared/ipc/projects'
import { epicNodeId, ticketNodeId } from '../../shared/layout/derived'
import { focusCanvasNode } from '../find/canvas-requests'
import { setView } from '../session/navigation'
import { useNow } from '../limits/useLimits'
import { useWorkflow } from '../workflow/useWorkflow'
import { stuckLine, ticketKeyOf, ticketRef, titlesOf, waitsText } from './board'
import { usePipeline } from './usePipeline'
import './pipeline.css'

/** The Tickets of each column: main computes every Stage from the snapshot's own Pipeline, so `stage` is one of its ids. */
function byColumn(snapshot: PipelineSnapshot): Map<string, PipelineTicket[]> {
  const columns = new Map<string, PipelineTicket[]>(snapshot.pipeline.map((column) => [column.id, []]))
  for (const ticket of snapshot.tickets) columns.get(ticket.stage)?.push(ticket)
  return columns
}

interface TicketCardProps {
  ticket: PipelineTicket
  title: string | undefined
  /** The tooltip line of a stuck Ticket (stuckLine); null while it is not stuck. */
  stuck: string | null
  onOpen: () => void
}

/** One Ticket on the board: what it is, who it waits for, and its flags. */
function TicketCard({ ticket, title, stuck, onOpen }: TicketCardProps) {
  const blocked = ticket.blocked === null ? null : ticket.blocked.reason ? `Blocked: ${ticket.blocked.reason}` : 'Blocked'
  const name = title === undefined ? ticketRef(ticket) : `${ticketRef(ticket)} — ${title}`
  return (
    <li>
      <button
        type="button"
        className="w-pipeline-card"
        data-testid="pipeline-card"
        data-epic={ticket.epic}
        data-ticket={ticket.num}
        data-stage={ticket.stage}
        data-blocked={ticket.blocked === null ? undefined : 'true'}
        data-stuck={stuck === null ? undefined : 'true'}
        title={stuck === null ? name : `${name}\n${stuck}`}
        onClick={onOpen}
      >
        <span className="w-pipeline-card__head">
          <span className="w-pipeline-card__ref w-mono" data-testid="pipeline-ref">
            {ticketRef(ticket)}
          </span>
          {ticket.sub !== null ? (
            <span className={`w-pipeline-flag w-pipeline-flag--${ticket.sub === 'failing' ? 'attention' : 'working'}`} data-testid="pipeline-sub">
              {ticket.sub}
            </span>
          ) : null}
        </span>
        {title !== undefined ? (
          <span className="w-pipeline-card__title" data-testid="pipeline-title">
            {title}
          </span>
        ) : null}
        {blocked !== null || ticket.rework || ticket.waits !== null ? (
          <span className="w-pipeline-card__flags">
            {blocked !== null ? (
              <span className="w-pipeline-flag w-pipeline-flag--attention" data-testid="pipeline-blocked" title={blocked}>
                {blocked}
              </span>
            ) : null}
            {ticket.rework ? (
              <span className="w-pipeline-flag w-pipeline-flag--attention" data-testid="pipeline-rework" title="Back in work after a failed review or check">
                Rework
              </span>
            ) : null}
            {ticket.waits !== null ? (
              <span className="w-pipeline-card__waits" data-testid="pipeline-waits">
                {waitsText(ticket.waits)}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    </li>
  )
}

interface ColumnProps {
  column: PipelineColumn
  tickets: readonly PipelineTicket[]
  titles: Readonly<Record<string, string>>
  /** The board's clock, for stuckLine. */
  now: number
  onOpenTicket: (ticket: { epic: string; num: number }) => void
}

function Column({ column, tickets, titles, now, onOpenTicket }: ColumnProps) {
  // Done is folded into its count until a click opens it; the choice lasts as long as the board.
  const [doneOpen, setDoneOpen] = useState(false)
  const folded = column.kind === 'done' && !doneOpen
  return (
    <section className="w-pipeline-column" data-testid="pipeline-column" data-stage={column.id} aria-label={column.title}>
      <header className="w-pipeline-column__header">
        <span className="w-pipeline-column__title" data-testid="pipeline-column-title">
          {column.title}
        </span>
        <span className="w-pipeline-column__count w-mono">{tickets.length}</span>
      </header>
      {column.kind === 'done' ? (
        <button type="button" className="w-pipeline-column__fold" aria-expanded={doneOpen} onClick={() => setDoneOpen(!doneOpen)}>
          {tickets.length} done
        </button>
      ) : null}
      {folded ? null : (
        <ul className="w-pipeline-column__cards">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticketKeyOf(ticket)}
              ticket={ticket}
              title={titles[ticketKeyOf(ticket)]}
              stuck={stuckLine(column, ticket, now)}
              onOpen={() => onOpenTicket({ epic: ticket.epic, num: ticket.num })}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

export interface PipelineBoardViewProps {
  /** The Project's name, for the heading. */
  name: string
  snapshot: PipelineSnapshot
  /** The Tickets' titles by ticketKeyOf; a Ticket without one shows its reference only. */
  titles: Readonly<Record<string, string>>
  onOpenTicket: (ticket: { epic: string; num: number }) => void
}

/** The board of one snapshot, without IPC. */
export function PipelineBoardView({ name, snapshot, titles, onOpenTicket }: PipelineBoardViewProps) {
  const columns = byColumn(snapshot)
  // Stuck is found again on every snapshot, which draws the board anew, and every minute by this
  // clock. shortcut: a snapshot is judged by a clock up to a minute old, so a Ticket may be framed up to a minute late; take the time of the snapshot when that minute matters.
  const now = useNow()
  return (
    <div className="w-pipeline" data-testid="pipeline-board" data-root={snapshot.root}>
      <h2 className="w-pipeline__heading">{name}</h2>
      {snapshot.error !== null ? (
        <p role="status" className="w-pipeline__notice">
          Some Stages may be short of facts: {snapshot.error}
        </p>
      ) : null}
      <div className="w-pipeline__columns">
        {snapshot.pipeline.map((column) => (
          <Column key={column.id} column={column} tickets={columns.get(column.id) ?? []} titles={titles} now={now} onOpenTicket={onOpenTicket} />
        ))}
      </div>
    </div>
  )
}

const styles = {
  message: { margin: 0, padding: 'var(--space-4)', fontSize: 'var(--text-13)', color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

/** Shows the Ticket's Card on the Canvas, as "Go to" of the palette does; its Epic's frame when the Card is folded away. */
function openTicketCard(projectId: string, ticket: { epic: string; num: number }): void {
  setView('canvas')
  focusCanvasNode(projectId, ticketNodeId(ticket.epic, ticket.num), epicNodeId(ticket.epic))
}

export interface PipelineBoardProps {
  /** The active Project; undefined while there is none. */
  project: Pick<ProjectView, 'id' | 'name' | 'path'> | undefined
}

/** The Pipeline view of the window: the board of the active Project, kept current by main. */
export function PipelineBoard({ project }: PipelineBoardProps) {
  const { snapshot, error } = usePipeline(project?.path)
  const { model } = useWorkflow(project?.path)
  if (project === undefined) return <p style={styles.message}>No project</p>
  if (error !== undefined)
    return (
      <p role="alert" style={styles.message}>
        The Pipeline could not be read: {error}
      </p>
    )
  if (snapshot === undefined) return <p style={styles.message}>Reading the Pipeline…</p>
  // Keyed by the root: another Project starts with its Done folded.
  return <PipelineBoardView key={snapshot.root} name={project.name} snapshot={snapshot} titles={titlesOf(model)} onOpenTicket={(ticket) => openTicketCard(project.id, ticket)} />
}
