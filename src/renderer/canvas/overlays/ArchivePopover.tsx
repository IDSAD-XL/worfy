// The Archive of the Canvas (ADR-0076, worfy-canvas ticket 09), next to Trash at the bottom centre:
// «Archive N» opens the archived Sessions that have no Binding, newest first, with a search by
// title, Restore on each row and «Restore all from today». There is no time limit: a Session stays
// here until it is restored. The Sessions with a Binding are in the history of their Ticket
// (badges/SessionHistory.tsx) and of their Epic (actions/EpicSessionHistory.tsx), which draw the
// same rows through SessionHistoryPopover below.
//
// This overlay also builds the Project's archive list (../archive-list.ts) once for the Canvas and
// publishes it, so a badge on each Ticket only reads its group. Show and Restore go through the
// Canvas's LayoutOps: each is a step of ⌘Z. On a read-only screen (worfy-link ticket 25) the lists
// can be read and every Show and Restore is inactive, with the reason.
import { useStoreApi, Panel } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { bindingWorkflowOf, type BindingTarget } from '../../../shared/binding/resolve'
import { resolveAgentBindings, useManualBindings, useSessionSignals } from '../../binding/store'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { writeAction } from '../../projects/read-only'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import {
  archivedSessionNodes,
  archivedToday,
  archiveList,
  publishArchive,
  restoreSessions,
  searchArchive,
  showSession,
  useArchive,
  type ArchivedSession,
} from '../archive-list'
import type { CanvasFlowNode } from '../nodes'
import { sessionSpot, spotInputs, spotKeepOut } from '../session-spot'
import { currentLayout, useLayout, useLayoutOps } from '../useLayout'
import { frameReserves } from './session-spots'
import './archive.css'

export const order = 31

/** The gap between a history button and its popover under it. */
const POPOVER_GAP = 4

/** «14:05» for a time of today, else «Oct 19, 14:05». */
function endLabel(time: number, now: number): string {
  const at = new Date(time)
  const clock = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (at.toDateString() === new Date(now).toDateString()) return clock
  return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock}`
}

/** Builds the Project's archive list from its Layout, the Sessions' history and their Bindings, and publishes it. */
function useArchiveFeed(projectId: string, root: string): void {
  const { state } = useLayout(projectId)
  const layout = state?.layout
  const { history } = useClaudeHome(root)
  const { model } = useWorkflow(root)
  const manual = useManualBindings(projectId)
  const sessionIds = useMemo(() => (layout === undefined ? [] : archivedSessionNodes(layout).map((node) => node.data.sessionId as string)), [layout])
  // shortcut: the transcript of every archived Session is read once per window to find its Binding;
  // redo when the archive grows to thousands of Sessions, by keeping the Binding in the archive record.
  const signals = useSessionSignals(root, sessionIds)
  const list = useMemo(() => {
    if (layout === undefined) return undefined
    const bindings = resolveAgentBindings({ sessionIds, signals, manual, workflow: bindingWorkflowOf(model) })
    const targets = new Map<string, BindingTarget>(sessionIds.flatMap((id) => (bindings.has(id) ? [[id, bindings.get(id)!.target] as const] : [])))
    return archiveList(layout, history, targets)
  }, [layout, history, model, manual, signals, sessionIds])
  useEffect(() => {
    if (list !== undefined) publishArchive(projectId, list)
  }, [projectId, list])
}

/** The Canvas's React Flow store; null where the button is drawn outside a Canvas. */
function useCanvasStore(): ReturnType<typeof useStoreApi<CanvasFlowNode>> | null {
  try {
    return useStoreApi<CanvasFlowNode>()
  } catch {
    return null
  }
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

function Rows({ sessions, action, run, readOnly, now }: RowsProps) {
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

/** Closes on Escape (that press does nothing else) and on a mousedown outside `inside`. */
function useDismiss(open: boolean, close: () => void, inside: readonly RefObject<HTMLElement | null>[]): void {
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && inside.every((ref) => ref.current?.contains(event.target as Node) !== true)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // The press that closes the popover does nothing else (the Esc of an active Node, of Focus mode).
      event.preventDefault()
      close()
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open, close, inside])
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

function Archive({ projectId, root }: { projectId: string; root: string }) {
  useArchiveFeed(projectId, root)
  const { unbound } = useArchive(projectId)
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** The time the popover was opened at: «today» and the times are counted from it. */
  const [openedAt, setOpenedAt] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const inside = useMemo(() => [box], [])
  useDismiss(open, close, inside)

  if (unbound.length === 0) return null
  const found = searchArchive(unbound, query)
  const today = archivedToday(unbound, openedAt)
  return (
    <Panel position="bottom-center" className="w-archive w-archive--panel nodrag nopan nowheel">
      <div ref={box} className="w-archive__root">
        {open ? (
          <div className="w-archive__popover" role="dialog" aria-label="Archive" data-testid="archive-popover">
            <div className="w-archive__heading">Archive</div>
            <div className="w-archive__tools">
              <input
                type="search"
                className="w-archive__search"
                placeholder="Search by title"
                aria-label="Search the archive by title"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="w-archive__action"
                {...(today.length === 0
                  ? { 'aria-disabled': 'true' as const, title: 'Nothing was archived today' }
                  : writeAction(readOnly, () => void restoreSessions(ops, today.map((session) => session.nodeId)), `Restore the ${today.length} Sessions archived today`))}
              >
                Restore all from today
              </button>
            </div>
            {found.length === 0 ? <div className="w-archive__empty">No Session matches</div> : null}
            <Rows sessions={found} action="Restore" readOnly={readOnly} now={openedAt} run={(session) => void restoreSessions(ops, [session.nodeId])} />
          </div>
        ) : null}
        <button
          type="button"
          className="w-archive__button"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`Archive: ${unbound.length} archived ${unbound.length === 1 ? 'Session' : 'Sessions'} without a Binding`}
          title="Archived Sessions without a Binding"
          data-testid="archive-button"
          onClick={() => {
            setOpenedAt(Date.now())
            setOpen((value) => !value)
          }}
        >
          Archive<span className="w-archive__count">{unbound.length}</span>
        </button>
      </div>
    </Panel>
  )
}

export default function ArchivePopover() {
  const project = activeProject(useProjects())
  if (project === undefined) return null
  return <Archive projectId={project.id} root={project.path} />
}
