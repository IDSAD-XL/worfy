import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Ticket } from '../../../shared/workflow/types'
import { invoke } from '../../ipc'
import { StatusChip } from '../../theme/primitives'
import { actions, badges, type SlotSubject } from '../badges'
import { blockedReason, ticketFile, ticketTitle, type AttentionReason } from '../epic-layout'
import type { TicketNodeData } from '../sources/epics'
import type { CanvasNodeProps } from './index'
import '../epic-frame.css'

// One Ticket inside its Epic frame: number, title, a state chip, what blocks it, and the two
// slots for badges (ticket 17) and actions (ticket 23). A double click opens the Ticket file in
// the default editor through `shell.openInEditor`. The Node comes from sources/epics.ts.
export const kind = 'ticket'
export const defaultWidth = 204
export const defaultHeight = 104

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
  if (placed.attention) return <div className="w-ticket__meta w-ticket__meta--attention">{attentionText(placed.attention)}</div>
  if (!ticket.blockedNums.length) return <div className="w-ticket__meta">no blockers</div>
  if (ticket.state !== 'done' && waitingOn.length)
    return (
      <div className="w-ticket__meta">
        waiting on <span className="w-mono w-ticket__nums">{list(waitingOn)}</span>
      </div>
    )
  return (
    <div className="w-ticket__meta">
      blocked by <span className="w-mono w-ticket__nums">{list(ticket.blockedNums)}</span> · done
    </div>
  )
}

function TicketNode({ data }: CanvasNodeProps) {
  const node = data.node.data as TicketNodeData
  const { projectId, root, ticket, placed } = node
  const subject: SlotSubject = { kind: 'ticket', projectId, root, ticket }
  const reason = ticket.state === 'blocked' ? blockedReason(ticket.statusRaw) : null
  const stateLabel = ticket.state === 'work' ? 'claimed' : ticket.state === 'none' ? 'no status' : ticket.state

  const open = () => {
    void invoke('shell.openInEditor', { projectId, path: ticketFile(root, ticket) }).then((result) => {
      if (!result.ok) console.error(`shell.openInEditor ${ticket.epic}/${ticket.num} failed:`, result.error)
    })
  }

  return (
    <article
      className={`w-ticket w-ticket--${ticket.state}${placed.ready ? ' w-ticket--ready' : ''}`}
      aria-label={`Ticket ${pad(ticket.num)}, ${stateLabel}`}
      data-testid="ticket-node"
      data-epic={ticket.epic}
      data-ticket={ticket.num}
      data-state={ticket.state}
      data-ready={placed.ready ? 'true' : undefined}
      title={ticket.fromBranch ? `${ticket.statusRaw ?? ''} (in ${ticket.fromBranch})` : (ticket.statusRaw ?? undefined)}
      onDoubleClick={open}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="w-ticket__handle" />
      <div className="w-ticket__top">
        <span className="w-mono w-ticket__num">{pad(ticket.num)}</span>
        <StateChip ticket={ticket} />
      </div>
      <div className="w-ticket__title">{ticketTitle(ticket)}</div>
      {reason ? <div className="w-ticket__reason">{reason}</div> : <BlockersLine data={node} />}
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
      <Handle type="source" position={Position.Right} isConnectable={false} className="w-ticket__handle" />
    </article>
  )
}

export default memo(TicketNode)
