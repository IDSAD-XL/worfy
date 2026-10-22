// The Archive of the Canvas (ADR-0076, worfy-canvas ticket 09), next to Trash at the bottom centre:
// «Archive N» opens the archived Sessions that have no Binding, newest first, with a search by
// title, Restore on each row and «Restore all from today». There is no time limit: a Session stays
// here until it is restored. The Sessions with a Binding are in the history of their Ticket
// (badges/SessionHistory.tsx) and of their Epic (actions/EpicSessionHistory.tsx), which draw the
// same rows through SessionHistoryPopover (../session-history.tsx).
//
// This overlay also builds the Project's archive list (../archive-list.ts) once for the Canvas and
// publishes it, so a badge on each Ticket only reads its group. Show and Restore go through the
// Canvas's LayoutOps: each is a step of ⌘Z. On a read-only screen (worfy-link ticket 25) the lists
// can be read and every Show and Restore is inactive, with the reason.
import { Panel } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { BindingTarget } from '../../../shared/binding/resolve'
import { manualRead, refreshSessionSignals, sessionSignalsOf, storedBindings, useBindingsStore, useManualBindings } from '../../binding/store'
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
  useArchive,
  type ArchivedSession,
} from '../archive-list'
import { Rows } from '../session-history'
import { useDismiss } from '../use-dismiss'
import { currentLayout, useLayout, useLayoutOps } from '../useLayout'
import './archive.css'

export const order = 31

/** `<root>\0<sessionId>` of each archived Session whose signals were asked for, and of each whose read is over. */
const asked = new Set<string>()
const useSignalsRead = create<{ done: Readonly<Record<string, true>> }>(() => ({ done: {} }))
const readKey = (root: string, sessionId: string): string => `${root}\0${sessionId}`

/**
 * Reads the transcript signals of these archived Sessions into the Bindings' store, and says which
 * of them are read (or failed to read); a new function whenever the store's signals change. Each
 * Session's are asked for once per window, however often the archived set changes: an archived
 * Session is over, its transcript does not change. A Session that comes back to life is restored by
 * main and leaves the archive. A read that failed counts as read — the Session is then without a
 * Binding — and is asked again the next time the archived set changes.
 */
function useArchivedSignals(root: string, sessionIds: readonly string[]): (sessionId: string) => boolean {
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
    return (sessionId: string) => sessionSignalsOf(root, sessionId) !== undefined || done[readKey(root, sessionId)] === true
  }, [all, done, root])
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
  const bindingsGot = useBindingsStore((store) => manualRead(store, projectId))
  // Keyed by the ids, not by the Layout: a change of the Layout that archives or restores nothing
  // keeps the same list, so a failed transcript read is asked again only when the set changes.
  const sessionKey = layout === undefined ? '' : archivedSessionNodes(layout).map((node) => node.data.sessionId as string).join('\0')
  const sessionIds = useMemo(() => (sessionKey === '' ? [] : sessionKey.split('\0')), [sessionKey])
  // shortcut: the transcript of every archived Session is read once per window to find its Binding;
  // redo when the archive grows to thousands of Sessions, by keeping the Binding in the archive record.
  const read = useArchivedSignals(root, sessionIds)
  const list = useMemo(() => {
    if (layout === undefined) return undefined
    // `manual` and `read` only say when to resolve again: storedBindings reads the store's Bindings and signals.
    void manual
    const bindings = storedBindings(projectId, root, sessionIds, model)
    const targets = new Map<string, BindingTarget>(sessionIds.flatMap((id) => (bindings.has(id) ? [[id, bindings.get(id)!.target] as const] : [])))
    // A branch or a worktree folder binds only through the workflow model: it must be read (or have failed) too.
    const workflowRead = model !== undefined || workflowError !== undefined
    return archiveList(layout, history, targets, (sessionId) => bindingsGot && workflowRead && read(sessionId))
  }, [projectId, root, layout, history, model, workflowError, manual, bindingsGot, read, sessionIds])
  useEffect(() => {
    if (list !== undefined) publishArchive(projectId, list)
  }, [projectId, list])
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
