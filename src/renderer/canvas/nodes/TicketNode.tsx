import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Ticket } from '../../../shared/workflow/types'
import { invoke } from '../../ipc'
import { useFileElsewhere } from '../../machines/useFileElsewhere'
import Stepper from '../../pipeline/Stepper'
import { stageOfTicket, usePipeline } from '../../pipeline/usePipeline'
import { StatusChip } from '../../theme/primitives'
import { actions, badges, type SlotSubject } from '../badges'
import { useProjectRepos } from '../badges/use-checks'
import { ticketFile, ticketTitle, type AttentionReason } from '../epic-layout'
import type { TicketNodeData } from '../sources/epics'
import type { CanvasNodeProps } from './index'
import '../epic-frame.css'

// One Ticket inside its Epic frame: number, title, the stepper of its Stage (worfy-pipeline ticket
// 05) — the status word only until main has computed the Stage, or when it could not — what blocks
// it, and the two slots for badges (ticket 17) and actions (ticket 23). A double click opens the Ticket file in
// the default editor through `shell.openInEditor`; in a window on a Linked machine it shows "File is
// on <Machine>" in place of the blockers line instead (worfy-link ticket 12). The Node comes from
// sources/epics.ts. A row that
// may be cut — the title past its line limit, the blockers line, the blocked reason — carries its
// whole text in its tooltip. In a Project over several repositories (ADR-0045) a chip next to the
// number names the Ticket's repository (its `Repo:` line), or says it has none.
export const kind = 'ticket'
// TICKET_WIDTH and TICKET_HEIGHT of epic-layout.ts; a literal, so Fast Refresh keeps working.
export const defaultWidth = 204
export const defaultHeight = 160

const pad = (num: number) => String(num).padStart(2, '0')
const list = (nums: readonly number[]) => nums.map(pad).join(', ')

function StateChip({ ticket }: { ticket: Ticket }) {
  switch (ticket.state) {
    case 'done':
      return <StatusChip status="done" label="done" />
    case 'work':
      return <StatusChip status="working" label="claimed" />
    case 'blocked':
      return <StatusChip status="blocked" label="blocked" />
    case 'open':
    case 'none':
      return (
        <span className="w-chip w-chip--open" data-status="open">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="8" cy="8" r="5" />
          </svg>
          {ticket.state === 'none' ? 'no status' : 'open'}
        </span>
      )
  }
}

/**
 * The chip is cut with "…" past this width; its tooltip has the whole name. It gives way before the
 * stepper beside it (flexShrink): the Stage is the Card's state, the repository's name is in the tooltip.
 */
const REPO_CHIP_STYLE = { display: 'block', minWidth: 0, maxWidth: 84, flexShrink: 100, overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '16px' } as const

/** The Ticket's repository, shown only in a Project with more than one. */
function RepoChip({ root, repo }: { root: string; repo: string | null | undefined }) {
  const repos = useProjectRepos(root)
  if (!repos || repos.repos.length < 2) return null
  const name = repo?.trim() || null
  return (
    <span
      className="w-chip w-chip--open w-mono"
      style={REPO_CHIP_STYLE}
      data-testid="ticket-repo"
      data-repo={name ?? undefined}
      title={name ? `repository ${name}` : 'no repository: the Ticket has no Repo: line'}
    >
      {name ?? 'no repo'}
    </span>
  )
}

function attentionText(reason: AttentionReason): string {
  switch (reason.kind) {
    case 'unparsed':
      return `“Blocked by: ${reason.raw ?? ''}” is not a list of tickets`
    case 'missing-blocker':
      return `blocked by ${list(reason.missing)}, not in this epic`
    case 'cycle':
      return `blocking cycle: ${list(reason.cycle)}`
  }
}

function BlockersLine({ data }: { data: TicketNodeData }) {
  const { ticket, placed, waitingOn } = data
  if (placed.attention) {
    const text = attentionText(placed.attention)
    return (
      <div className="w-ticket__meta w-ticket__meta--attention" title={text}>
        {text}
      </div>
    )
  }
  if (!ticket.blockedNums.length) return <div className="w-ticket__meta">no blockers</div>
  if (ticket.state !== 'done' && waitingOn.length)
    return (
      <div className="w-ticket__meta" title={`waiting on ${list(waitingOn)}`}>
        waiting on <span className="w-mono w-ticket__nums">{list(waitingOn)}</span>
      </div>
    )
  return (
    <div className="w-ticket__meta" title={`blocked by ${list(ticket.blockedNums)} · done`}>
      blocked by <span className="w-mono w-ticket__nums">{list(ticket.blockedNums)}</span> · done
    </div>
  )
}

function TicketNode({ data, width }: CanvasNodeProps) {
  const node = data.node.data as TicketNodeData
  const { projectId, root, ticket, placed } = node
  const { snapshot } = usePipeline(root)
  const stage = stageOfTicket(snapshot, ticket)
  const column = stage === null ? undefined : snapshot?.pipeline[stage.index]
  // The top row holds the stepper with the Ready chip or the repository chip only in its narrow form.
  const repos = useProjectRepos(root)
  const narrow = placed.ready || (repos?.repos.length ?? 0) > 1 || (width ?? defaultWidth) < defaultWidth
  const subject: SlotSubject = { kind: 'ticket', projectId, root, ticket }
  const reason = ticket.state === 'blocked' ? (ticket.blockedReason ?? null) : null
  // The tooltip shows the Status line with the reason, as the single old line `blocked — <reason>` did.
  const status = ticket.statusRaw === null ? null : reason ? `${ticket.statusRaw} — ${reason}` : ticket.statusRaw
  const stateLabel = ticket.state === 'work' ? 'claimed' : ticket.state === 'none' ? 'no status' : ticket.state
  const title = ticketTitle(ticket)

  const file = useFileElsewhere({ className: 'w-ticket__meta' })

  const open = () => {
    // In a window on a Linked machine the Ticket file lies there: the hint instead of its editor.
    if (file.elsewhere) {
      file.show()
      return
    }
    void invoke('shell.openInEditor', { projectId, path: ticketFile(root, ticket) }).then((result) => {
      if (!result.ok) console.error(`shell.openInEditor ${ticket.epic}/${ticket.num} failed:`, result.error)
    })
  }

  return (
    <article
      className={`w-ticket w-ticket--${ticket.state}${placed.ready ? ' w-ticket--ready' : ''}`}
      aria-label={`Ticket ${pad(ticket.num)}, ${column?.title ?? stateLabel}`}
      data-testid="ticket-node"
      data-epic={ticket.epic}
      data-ticket={ticket.num}
      data-state={ticket.state}
      data-ready={placed.ready ? 'true' : undefined}
      title={ticket.fromBranch ? `${status ?? ''} (in ${ticket.fromBranch})` : (status ?? undefined)}
      onDoubleClick={open}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="w-ticket__handle" />
      <div className="w-ticket__top">
        <span className="w-mono w-ticket__num">{pad(ticket.num)}</span>
        <RepoChip root={root} repo={ticket.repo} />
        {stage !== null && snapshot !== undefined ? <Stepper pipeline={snapshot.pipeline} stage={stage} narrow={narrow} /> : <StateChip ticket={ticket} />}
        {placed.ready ? (
          // In the ready Wave: marked here, not by the Ticket's place in its column (ADR-0037).
          <span className="w-chip w-chip--ready w-ticket__ready" data-status="ready" data-testid="ticket-ready">
            <span className="w-chip__dot" aria-hidden="true" />
            Ready
          </span>
        ) : null}
      </div>
      <div className="w-ticket__title" title={title}>
        {title}
      </div>
      {file.hint !== null ? (
        file.hint
      ) : reason ? (
        <div className="w-ticket__reason" title={reason}>
          {reason}
        </div>
      ) : (
        <BlockersLine data={node} />
      )}
      {badges.length || actions.length ? (
        <div className="w-ticket__slots">
          {badges.length ? (
            <div className="w-ticket__badges">
              {badges.map(({ id, Component }) => (
                <Component key={id} subject={subject} />
              ))}
            </div>
          ) : null}
          {actions.length ? (
            <div className="w-ticket__actions nodrag">
              {actions.map(({ id, Component }) => (
                <Component key={id} subject={subject} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={false} className="w-ticket__handle" />
    </article>
  )
}

// Drawn again only for new data: dragging the frame gives every Ticket a new place on each mouse
// move, and the Ticket draws nothing from it. React Flow's own wrapper draws the selection ring.
export default memo(TicketNode, (before, after) => before.data === after.data)
