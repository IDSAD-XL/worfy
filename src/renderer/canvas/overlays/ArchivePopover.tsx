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
import { create } from 'zustand'
import { bindingWorkflowOf, type BindingTarget } from '../../../shared/binding/resolve'
import type { SessionBindingSignals } from '../../../shared/ipc/bindings'
import { refreshSessionSignals, resolveAgentBindings, sessionSignalsOf, useBindingsStore, useManualBindings } from '../../binding/store'
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

/** `<root>\0<sessionId>` of each archived Session whose signals were asked for, and of each whose read is over. */
const asked = new Set<string>()
const useSignalsRead = create<{ done: Readonly<Record<string, true>> }>(() => ({ done: {} }))
const readKey = (root: string, sessionId: string): string => `${root}\0${sessionId}`

/**
 * The transcript signals of these archived Sessions, and which of them are read (or failed to
 * read). Each Session's are asked for once per window, however often the archived set changes: an
 * archived Session is over, its transcript does not change. A Session that comes back to life is
 * restored by main and leaves the archive. A read that failed counts as read — the Session is then
 * without a Binding — and is asked again the next time the archived set changes.
 */
function useArchivedSignals(root: string, sessionIds: readonly string[]): { signals: ReadonlyMap<string, SessionBindingSignals>; read: (sessionId: string) => boolean } {
  useEffect(() => {
    for (const sessionId of sessionIds) {
      const key = readKey(root, sessionId)
      if (asked.has(key)) continue
      asked.add(key)
      // A failed read is logged by the store, which then has no signals for the Session.
      void refreshSessionSignals(root, sessionId).finally(() => {
        if (sessionSignalsOf(root, sessionId) === undefined) asked.delete(key)
        useSignalsRead.setState(({ done }) => ({ done: { ...done, [key]: true } }))
      })
    }
  }, [root, sessionIds])
  const all = useBindingsStore((store) => store.signals)
  const done = useSignalsRead((store) => store.done)
  return useMemo(() => {
    // `all` only says when to read again: the store's keys are its own, sessionSignalsOf reads them.
    void all
    const signals = new Map<string, SessionBindingSignals>()
    for (const sessionId of sessionIds) {
      const found = sessionSignalsOf(root, sessionId)
      if (found !== undefined) signals.set(sessionId, found)
    }
    return { signals, read: (sessionId: string) => signals.has(sessionId) || done[readKey(root, sessionId)] === true }
  }, [all, done, root, sessionIds])
}

/** Builds the Project's archive list from its Layout, the Sessions' history and their Bindings, and publishes it. */
function useArchiveFeed(projectId: string, root: string): void {
  const { state } = useLayout(projectId)
  const layout = state?.layout
  const { history } = useClaudeHome(root)
  const { model, error: workflowError } = useWorkflow(root)
  const manual = useManualBindings(projectId)
  // Undefined until main has answered `bindings.get`: until then no Session is known to be without a
  // Binding. An error answer counts as read, like the workflow model's: a machine that does not
  // answer must not keep the Sessions pending and the Archive button away for good.
  const manualRead = useBindingsStore((store) => store.manual[projectId] !== undefined || store.manualError[projectId] !== undefined)
  const sessionIds = useMemo(() => (layout === undefined ? [] : archivedSessionNodes(layout).map((node) => node.data.sessionId as string)), [layout])
  // shortcut: the transcript of every archived Session is read once per window to find its Binding;
  // redo when the archive grows to thousands of Sessions, by keeping the Binding in the archive record.
  const { signals, read } = useArchivedSignals(root, sessionIds)
  const list = useMemo(() => {
    if (layout === undefined) return undefined
    const bindings = resolveAgentBindings({ sessionIds, signals, manual, workflow: bindingWorkflowOf(model) })
    const targets = new Map<string, BindingTarget>(sessionIds.flatMap((id) => (bindings.has(id) ? [[id, bindings.get(id)!.target] as const] : [])))
    // A branch or a worktree folder binds only through the workflow model: it must be read (or have failed) too.
    const workflowRead = model !== undefined || workflowError !== undefined
    return archiveList(layout, history, targets, (sessionId) => manualRead && workflowRead && read(sessionId))
  }, [layout, history, model, workflowError, manual, manualRead, signals, read, sessionIds])
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

function Archive({ projectId, root }: { projectId: string; root: string }) {
  useArchiveFeed(projectId, root)
  const { unbound, pending } = useArchive(projectId)
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

  // Nothing left to list: closed, so it does not open again by itself when a Session is archived later.
  if (unbound.length === 0 && open) setOpen(false)
  if (unbound.length === 0) return null
  const restoreFrom = (sessions: readonly ArchivedSession[]) => {
    const layout = currentLayout(projectId)
    if (layout !== undefined) void restoreSessions(ops, layout, sessions.map((session) => session.nodeId))
  }
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
                {...(pending.length > 0
                  ? { 'aria-disabled': 'true' as const, title: 'The Bindings of the archived Sessions are still being read' }
                  : today.length === 0
                    ? { 'aria-disabled': 'true' as const, title: 'Nothing was archived today' }
                    : writeAction(readOnly, () => void restoreFrom(today), `Restore the ${today.length} Sessions archived today`))}
              >
                Restore all from today
              </button>
            </div>
            {found.length === 0 ? <div className="w-archive__empty">No Session matches</div> : null}
            {pending.length > 0 ? (
              <div className="w-archive__empty" data-testid="archive-pending">
                Reading the Bindings of {pending.length} more {pending.length === 1 ? 'Session' : 'Sessions'}…
              </div>
            ) : null}
            <Rows sessions={found} action="Restore" readOnly={readOnly} now={openedAt} run={(session) => void restoreFrom([session])} />
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
