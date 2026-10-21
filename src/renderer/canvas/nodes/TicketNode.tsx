import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Ticket } from '../../../shared/workflow/types'
import { requestFocus } from '../../focus/focus-state'
import { useInFocusTile } from '../../focus/focus-tile'
import { invoke } from '../../ipc'
import { useFileElsewhere } from '../../machines/useFileElsewhere'
import Stepper from '../../pipeline/Stepper'
import { stageOfTicket, usePipeline } from '../../pipeline/usePipeline'
import { StatusChip } from '../../theme/primitives'
import { showRevealed } from '../../toast/revealed'
import { actions, badges, type SlotSubject } from '../badges'
import { useProjectRepos } from '../badges/use-checks'
import { ticketTitle } from '../epic-layout'
import type { TicketNodeData } from '../sources/epics'
import { blockersLine, blockersString, pad, type TICKET_MIN_HEIGHT, type TICKET_WIDTH } from '../ticket-card'
import type { CanvasNodeProps } from './index'
import { TicketBody } from './TicketBody'
import { useTicketText } from './ticket-text'
import '../epic-frame.css'

// One Ticket inside its Epic frame: number, title, the stepper of its Stage (worfy-pipeline ticket
// 05) — the status word only until main has computed the Stage, or when it could not — what blocks
// it, and the two slots for badges (ticket 17) and actions (ticket 23). A double click on the card
// opens focus mode on this Ticket (requestFocus of focus/focus-state.ts). In a tile of focus mode
// (focus/focus-tile.ts) the Ticket shows its whole file as markdown under the same header
// (TicketBody.tsx) and the title uncut, and "Open in editor" in the header opens the file — at the
// path main found — in the default editor through `shell.openInEditor`; in a window on a Linked
// machine that button shows the toast "File is on <Machine>" instead (worfy-link ticket 12,
// worfy-ui ticket 16). The card on the Canvas reads no file. The Node comes from sources/epics.ts. In a
// Project over several repositories (ADR-0045) a chip next to the number names the Ticket's
// repository (its `Repo:` line), or says it has none.
//
// Nothing on the card is cut (worfy-canvas ticket 18): the title, the reason and the blockers line
// wrap, the top row and the checks chips take more lines. Only at the far zoom level (zoom-level.ts)
// the card is a block without text (epic-frame.css); at the full and compact levels it is whole. The Node is as tall as ticket-card.ts
// computes from the same data, so whatever is added here needs room there too.
export const kind = 'ticket'
// TICKET_WIDTH and TICKET_MIN_HEIGHT of ticket-card.ts; literals, so Fast Refresh keeps working, checked against them by type.
export const defaultWidth = 240 satisfies typeof TICKET_WIDTH
export const defaultHeight = 138 satisfies typeof TICKET_MIN_HEIGHT

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

/** The Ticket's repository, shown only in a Project with more than one: its whole name (`.w-ticket__repo`). */
function RepoChip({ root, repo }: { root: string; repo: string | null | undefined }) {
  const repos = useProjectRepos(root)
  if (!repos || repos.repos.length < 2) return null
  const name = repo?.trim() || null
  return (
    <span
      className="w-chip w-chip--open w-mono w-ticket__repo"
      data-testid="ticket-repo"
      data-repo={name ?? undefined}
      title={name ? `repository ${name}` : 'no repository: the Ticket has no Repo: line'}
    >
      {name ?? 'no repo'}
    </span>
  )
}

/** The mark of the header's rows in focus mode: a toast keeps clear of them (toast/ToastRegion.tsx). */
type KeepOut = { 'data-toast-keep-out'?: '' }

/** The line under the title, the same text as ticket-card.ts gives room for (`blockersLine`). */
function BlockersLine({ data, keepOut }: { data: TicketNodeData; keepOut: KeepOut }) {
  const { ticket, placed, waitingOn } = data
  const line = blockersLine(ticket, placed.attention, waitingOn)
  return (
    <div className={`w-ticket__meta${line.attention ? ' w-ticket__meta--attention' : ''}`} title={blockersString(line)} {...keepOut}>
      {line.lead}
      {line.nums === null ? null : <span className="w-mono w-ticket__nums">{line.nums}</span>}
      {line.tail}
    </div>
  )
}

function TicketNode({ id, data, width }: CanvasNodeProps) {
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

  const file = useFileElsewhere()
  const inFocus = useInFocusTile()
  // Only the focused Ticket reads its file; the card on the Canvas stays compact.
  const read = useTicketText(inFocus ? { projectId, ticket } : null)
  // In focus mode the header — its rows above the body, with "Open in editor" and the actions — stays
  // clear of toasts; on the Canvas a card is not marked, the Canvas moves under the toasts.
  const keepOut: KeepOut = inFocus ? { 'data-toast-keep-out': '' } : {}

  const openInEditor = () => {
    // In a window on a Linked machine the Ticket file lies there: the toast instead of its editor.
    if (file.elsewhere) {
      file.show()
      return
    }
    if (read.path === undefined) return
    void invoke('shell.openInEditor', { projectId, path: read.path }).then((result) => {
      if (!result.ok) console.error(`shell.openInEditor ${ticket.epic}/${ticket.num} failed:`, result.error)
      // A symlinked Ticket that leads to anything but a document: main asked, and the user chose to see it in the file manager.
      else if (result.value.revealedIn !== undefined) showRevealed(result.value.revealedIn)
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
      data-focused={inFocus ? 'true' : undefined}
      title={ticket.fromBranch ? `${status ?? ''} (in ${ticket.fromBranch})` : (status ?? undefined)}
      onDoubleClick={inFocus ? undefined : () => requestFocus([id])}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="w-ticket__handle" />
      <div className="w-ticket__top" {...keepOut}>
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
        {inFocus ? (
          <button
            type="button"
            className="w-focus__button w-ticket__open"
            onClick={openInEditor}
            disabled={!file.elsewhere && read.path === undefined}
            title={read.path ?? 'The Ticket file has not been read'}
          >
            Open in editor
          </button>
        ) : null}
      </div>
      <div className="w-ticket__title" title={title} {...keepOut}>
        {title}
      </div>
      {reason ? (
        <div className="w-ticket__reason" title={reason} {...keepOut}>
          {reason}
        </div>
      ) : (
        <BlockersLine data={node} keepOut={keepOut} />
      )}
      {badges.length || actions.length ? (
        <div className="w-ticket__slots" {...keepOut}>
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
      {inFocus ? <TicketBody projectId={projectId} read={read} /> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} className="w-ticket__handle" />
    </article>
  )
}

// Drawn again only for new data: dragging the frame gives every Ticket a new place on each mouse
// move, and the Ticket draws nothing from it. React Flow's own wrapper draws the selection ring.
export default memo(TicketNode, (before, after) => before.data === after.data)
