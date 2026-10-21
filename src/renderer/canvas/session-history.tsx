// The rows of archived Sessions and the «N sessions» history of a Ticket or an Epic frame
// (worfy-canvas ticket 09): the button on the Ticket (badges/SessionHistory.tsx) and on the frame
// (actions/EpicSessionHistory.tsx), and its popover with Show on each row. The Archive popover next
// to Trash (overlays/ArchivePopover.tsx) draws its rows and closes the same way.
import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import { showSession, type ArchivedSession } from './archive-list'
import { useCanvasStore } from './canvas-store'
import { frameReserves } from './overlays/session-spots'
import { sessionSpot, spotInputs, spotKeepOut } from './session-spot'
import { useDismiss } from './use-dismiss'
import { currentLayout, useLayoutOps } from './useLayout'
import './overlays/archive.css'

/** The gap between a history button and its popover under it. */
const POPOVER_GAP = 4

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

export interface SessionHistoryPopoverProps {
  projectId: string
  /** The popover's heading and accessible name, e.g. «Sessions of demo/07». */
  heading: string
  sessions: readonly ArchivedSession[]
  /** The button the popover opens under: it is not a dismissing click. */
  anchor: RefObject<HTMLElement | null>
  /** Where the popover is drawn, in window coordinates: under the button, read when it was clicked. */
  place: { top: number; left: number }
  testId: string
  onClose: () => void
}

/**
 * The archived Sessions of a Ticket or an Epic, each with its title, the time it ended and Show. It
 * is drawn into document.body with `position: fixed`, under its button: inside the Node the
 * Canvas's zoom would scale it and the Epic frame would cut it off.
 */
export function SessionHistoryPopover({ projectId, heading, sessions, anchor, place, testId, onClose }: SessionHistoryPopoverProps) {
  const readOnly = useReadOnly()
  const show = useShowSession(projectId)
  const popover = useRef<HTMLDivElement>(null)
  const [now] = useState(() => Date.now())
  const inside = useMemo(() => [popover, anchor], [anchor])
  useDismiss(true, onClose, inside)
  return createPortal(
    <div
      ref={popover}
      className="w-archive w-archive__popover w-archive__popover--history nodrag nopan nowheel"
      role="dialog"
      aria-label={heading}
      data-testid={testId}
      style={{ top: place.top, left: place.left }}
      // React passes the popover's events up to the Node it was opened from: a click here must not select or open it.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="w-archive__heading">{heading}</div>
      <Rows
        sessions={sessions}
        action="Show"
        readOnly={readOnly}
        now={now}
        run={(session) => {
          onClose()
          void show(session)
        }}
      />
    </div>,
    document.body,
  )
}

/** The button «N sessions» on a Ticket or an Epic frame and its history popover. */
export function SessionHistoryButton({ projectId, sessions, heading, label, className, testId }: { projectId: string; sessions: readonly ArchivedSession[]; heading: string; label: string; className: string; testId: string }): ReactNode {
  /** Where the open popover is drawn; null while it is closed. */
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(null), [])
  // The list emptied (its last Session was shown elsewhere): closed, so it does not open again by itself later.
  if (sessions.length === 0 && open !== null) setOpen(null)
  if (sessions.length === 0) return null
  const count = `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${className} nodrag`}
        aria-label={`${count} ${label}`}
        aria-expanded={open !== null}
        aria-haspopup="dialog"
        title={`${count} ${label}`}
        data-testid={`${testId}-button`}
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          setOpen((value) => (value === null ? { top: rect.bottom + POPOVER_GAP, left: rect.left } : null))
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {count}
      </button>
      {open !== null ? <SessionHistoryPopover projectId={projectId} heading={heading} sessions={sessions} anchor={button} place={open} testId={testId} onClose={close} /> : null}
    </>
  )
}

