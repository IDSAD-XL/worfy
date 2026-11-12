// The rows of archived Sessions and the «N sessions» history of a Ticket or an Epic frame
// (worfy-canvas ticket 09): the button on the Ticket (badges/SessionHistory.tsx) and on the frame
// (actions/EpicSessionHistory.tsx), and its popover with Show on each row: a popover of the kit
// (theme/kit/Popover.tsx) with the in-node mark. The Archive popover next to Trash
// (overlays/ArchivePopover.tsx) draws its rows.
import { useCallback, useState, type ReactNode } from 'react'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import { Popover } from '../theme/kit/Popover'
import { showSession, type ArchivedSession } from './archive-list'
import { useCanvasStore } from './canvas-store'
import { frameReserves } from './overlays/session-spots'
import { sessionSpot, spotInputs, spotKeepOut } from './session-spot'
import { currentLayout, useLayoutOps } from './useLayout'
import './overlays/archive.css'

/** «14:05» for a time of today, else «Oct 19, 14:05». */
function endLabel(time: number, now: number): string {
  const at = new Date(time)
  const clock = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (at.toDateString() === new Date(now).toDateString()) return clock
  return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock}`
}

/**
 * Show from a Ticket's or an Epic's history: the Node comes back next to its Ticket or its Epic's
 * frame header, right of the strip of frames (session-spot.ts); without them drawn, at its old place.
 */
function useShowSession(projectId: string): (session: ArchivedSession) => Promise<void> {
  const ops = useLayoutOps()
  const store = useCanvasStore()
  return useCallback(
    async (session) => {
      const layout = currentLayout(projectId)
      if (layout === undefined) return
      const drawn = store ? spotInputs(store.getState().nodeLookup.values(), frameReserves(projectId)) : undefined
      const spot = drawn === undefined ? undefined : sessionSpot(session.binding, drawn.frames, drawn.strip)
      await showSession(ops, layout, session.nodeId, spot, drawn === undefined ? [] : spotKeepOut(drawn))
    },
    [ops, store, projectId],
  )
}

interface RowsProps {
  sessions: readonly ArchivedSession[]
  /** The button of each row: Show in a history, Restore in the Archive. */
  action: 'Show' | 'Restore'
  run: (session: ArchivedSession) => void
  readOnly: string | null
  now: number
}

export function Rows({ sessions, action, run, readOnly, now }: RowsProps) {
  return (
    <ul className="w-archive__list">
      {sessions.map((session) => (
        <li key={session.nodeId} className="w-archive__row" data-testid="archive-row" data-node-id={session.nodeId}>
          <span className="w-archive__title" title={session.title}>
            {session.title}
          </span>
          <span className="w-archive__time" title={session.endedAt === null ? 'When it was archived' : 'When the Session ended'}>
            {endLabel(session.endedAt ?? session.archivedAt, now)}
          </span>
          <button type="button" className="w-archive__action" aria-label={`${action} ${session.title}`} {...writeAction(readOnly, () => run(session))}>
            {action}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The rows of a Ticket's or an Epic's history, each with Show; the times are counted from when it opened. */
function HistoryRows({ projectId, sessions, close }: { projectId: string; sessions: readonly ArchivedSession[]; close: () => void }) {
  const readOnly = useReadOnly()
  const show = useShowSession(projectId)
  const [now] = useState(() => Date.now())
  return (
    <Rows
      sessions={sessions}
      action="Show"
      readOnly={readOnly}
      now={now}
      run={(session) => {
        close()
        void show(session)
      }}
    />
  )
}

/**
 * The button «N sessions» on a Ticket or an Epic frame and its history popover: the archived Sessions
 * of the Ticket or the Epic, each with its title, the time it ended and Show. The popover hangs under
 * the button, and flips over it or slides along the edge where the window has no room. It is a
 * popover of the Node: a press inside it leaves the Node active, and a click there neither selects
 * nor opens the Node.
 */
export function SessionHistoryButton({ projectId, sessions, heading, label, className, testId }: { projectId: string; sessions: readonly ArchivedSession[]; heading: string; label: string; className: string; testId: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  // The list emptied (its last Session was shown elsewhere): closed, so it does not open again by itself later.
  if (sessions.length === 0 && open) setOpen(false)
  if (sessions.length === 0) return null
  const count = `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={heading}
      testId={testId}
      className="w-archive w-archive__popover w-archive__popover--history"
      side="bottom"
      align="start"
      inNode
      trigger={
        <button
          type="button"
          className={`${className} nodrag`}
          aria-label={`${count} ${label}`}
          title={`${count} ${label}`}
          data-testid={`${testId}-button`}
          // The click is the popover's, not the Node's: it must not select or open the Node.
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {count}
        </button>
      }
    >
      <div className="w-archive__heading">{heading}</div>
      <HistoryRows projectId={projectId} sessions={sessions} close={close} />
    </Popover>
  )
}
