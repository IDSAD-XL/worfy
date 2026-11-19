import { useEffect } from 'react'
import { worktreeOfTicket } from '../../../shared/ipc/checks'
import { ticketNodeId } from '../../../shared/layout/derived'
import { changesNodeOf, changesPlace, changesTitle, hasChangesSubject, openChanges, takeOpenRequest, useOpenRequests, type ChangesSubject } from '../../changes/open'
import { useReadOnly } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import { useTicketChecksOf } from '../badges/use-checks'
import type { SlotProps } from '../badges'
import { useCanvasStore } from '../canvas-store'
import { frameReserves } from '../overlays/session-spots'
import { sessionSpot, spotInputs, spotKeepOut } from '../session-spot'
import { currentLayout, useLayoutOps } from '../useLayout'
import { ActionButton } from './action-button'

// "Changes" on a Ticket card (worfy-changes-view ticket 03): opens the Ticket's Changes Node, the diff of its worktree
// or branch against the base (canvas/nodes/ChangesNode.tsx). Shown on a Ticket with a worktree (the checks snapshot),
// a worktree branch, a `Branch:` line or work on it (changes/open.ts, hasChangesSubject); without a count of lines,
// which is part 2. The first click puts the Node right of the strip of Epic frames at the Ticket's height, on a spot
// that covers nothing (changes/open.ts, changesPlace); a second click goes to the Node already there. It is also how
// Open changes of the Command palette opens the Node: the palette centers the Canvas on the card and the button takes
// its request. Reading the diff writes nothing; a new Node is a change of the Layout, so a read-only screen only goes
// to a Node that is there.

export const order = 33

/** The card's rect on the Canvas, when React Flow draws it. */
function cardRect(store: ReturnType<typeof useCanvasStore>, subject: ChangesSubject): { x: number; y: number; w: number; h: number } | null {
  const card = store?.getState().nodeLookup.get(ticketNodeId(subject.epic, subject.num))
  if (card === undefined) return null
  const { x, y } = card.internals.positionAbsolute
  return { x, y, w: card.measured.width ?? card.width ?? 0, h: card.measured.height ?? card.height ?? 0 }
}

function ChangesButton({ projectId, root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  const sources = useTicketChecksOf(root, ticket) ?? []
  const { model } = useWorkflow(root)
  const readOnly = useReadOnly()
  const ops = useLayoutOps()
  const store = useCanvasStore()
  const request = useOpenRequests((state) => state.request)
  const tickets = model?.tickets ?? [ticket]
  const worktree = sources.some(({ snapshot }) => snapshot !== undefined && worktreeOfTicket(snapshot, ticket, tickets) !== null)
  const shown = hasChangesSubject(ticket, worktree)
  const subject: ChangesSubject = { epic: ticket.epic, num: ticket.num }

  const open = (): Promise<string | undefined> =>
    openChanges(
      {
        projectId,
        nodes: currentLayout(projectId)?.nodes ?? [],
        apply: async (op) => {
          await ops.apply(op)
          return undefined
        },
        place: () => {
          const drawn = store ? spotInputs(store.getState().nodeLookup.values(), frameReserves(projectId)) : undefined
          const spot = drawn === undefined ? undefined : sessionSpot({ kind: 'ticket', epic: subject.epic, num: subject.num }, drawn.frames, drawn.strip)
          return changesPlace(currentLayout(projectId)?.nodes ?? [], spot, cardRect(store, subject), drawn === undefined ? [] : spotKeepOut(drawn))
        },
      },
      subject,
    )

  // Open changes of the palette, for this Ticket: taken once, as a click.
  const asked = request !== null && request.projectId === projectId && request.epic === subject.epic && request.num === subject.num
  useEffect(() => {
    if (asked && takeOpenRequest(projectId, subject)) void open()
    // `open` reads the Layout and the Canvas when it runs; the request is all that starts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked])

  if (!shown) return null
  const exists = changesNodeOf(currentLayout(projectId)?.nodes ?? [], subject) !== undefined
  const inactive = readOnly !== null && !exists
  return <ActionButton label="Changes" testId="action-changes" enabled={!inactive} title={inactive ? readOnly : changesTitle(subject)} run={open} />
}

export default function Changes({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <ChangesButton {...subject} /> : null
}
