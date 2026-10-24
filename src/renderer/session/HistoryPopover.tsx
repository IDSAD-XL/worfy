import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { HistorySession } from '../../shared/ipc/claude-home'
import type { ProjectView } from '../../shared/ipc/projects'
import type { ResumeVerdict } from '../../shared/ipc/sessions'
import { useOrchestratorViews } from '../canvas/nodes/orchestrator-view'
import { shownOnCanvas } from '../../shared/layout/derived'
import { showNode } from '../canvas/show-node'
import { applyLayoutOp, useLayout } from '../canvas/useLayout'
import { focusSessionNode } from '../claude-home/focus'
import { externalSource, readSessionNodeData, SESSION_KIND, showSessionNodeOp, worfySessionIds, worfySessions } from '../claude-home/session-nodes'
import { refreshClaudeHome, useClaudeHome } from '../claude-home/useClaudeHome'
import { invoke } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useReadOnly } from '../projects/useProjects'
import { setView } from './navigation'
import { ensureProject, useSessionNodeViews } from './node-sessions'

// The history of a Project (ticket 18): every Session the Project's transcripts record, wherever
// it was started — newest first, with its title, where it was started, when it last changed and
// its branch (claude-home/useClaudeHome.ts reads them from ~/.claude). "Show" puts a read-only Node
// for it on the Canvas, or goes to the Node it has. "Resume" continues it in worfy on its Node
// (`sessions.resume`, src/main/agent/node-sessions.ts); main's rule of Resume
// (src/main/agent/resume.ts) also decides which rows offer it, and the row says why not.
//
// Where a row says the Session was started (worfy-week ticket 12): «worfy» for a Session worfy runs
// or has a Node of — the sidebar's rule (claude-home/session-nodes.ts, sessionRow) — else
// «desktop» or «terminal» by its `entrypoint`. `sdk-cli` is `claude -p` in a terminal. A finished
// `sdk-ts` Session no Node names any more — an earlier conversation of the Orchestrator, a Session
// whose Node was removed — is «worfy» too: worfy keeps no list of the Sessions it ran, and it is
// the program on the Agent SDK for TypeScript that writes transcripts into its Projects. Not so for
// one with a read-only Node: worfy found it running as someone else's. A live one follows the
// sidebar: worfy knows every Session it runs now, so an unknown live `sdk-ts` is not its.

/** Rows the popover shows; older Sessions stay in the transcripts. */
export const HISTORY_ROWS = 100

const styles = {
  root: {
    position: 'absolute',
    zIndex: 20,
    left: 8,
    right: 8,
    maxHeight: 360,
    overflow: 'auto',
    padding: 4,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-card, 8px)',
    background: 'var(--bg)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  },
  header: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 4px' },
  heading: { flex: 1, margin: 0, fontSize: 'var(--text-11)', fontWeight: 600, color: 'var(--text-muted)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  row: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2, padding: 4, borderBottom: '1px solid var(--border)' },
  top: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  title: { flex: 1, minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { display: 'flex', gap: 6, minWidth: 0, fontSize: 'var(--text-11)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden' },
  why: { fontSize: 'var(--text-11)', color: 'var(--text-secondary)' },
  button: {
    flex: 'none',
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
    lineHeight: '18px',
  },
  message: { margin: 4, fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

/** Ids of Sessions worfy and others run, as the Layout and main's views know them. */
interface KnownSessions {
  worfy: ReadonlySet<string>
  /** Named by a read-only Session Node: worfy found them running as someone else's. */
  external: ReadonlySet<string>
}

/** Where a Session was started: «worfy» when worfy runs or ran it, else by its transcript's `entrypoint`. */
function historySource(session: HistorySession, known: KnownSessions): string {
  if (known.worfy.has(session.sessionId)) return 'worfy'
  if (session.entrypoint === 'sdk-ts' && !session.live && !known.external.has(session.sessionId)) return 'worfy'
  return externalSource(session.entrypoint)
}

/** «5 Oct, 10:42», in the user's locale. */
function when(iso: string | undefined, fallback: number): string {
  const time = iso === undefined ? fallback : Date.parse(iso)
  if (!Number.isFinite(time)) return '—'
  return new Date(time).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** The verdicts of main's rule of Resume for the rows shown, asked again when the history or the live Sessions change. */
function useVerdicts(projectId: string, rows: readonly HistorySession[], liveKey: string): Readonly<Record<string, ResumeVerdict>> {
  const [verdicts, setVerdicts] = useState<Readonly<Record<string, ResumeVerdict>>>({})
  const ids = rows.map((row) => row.sessionId).join(',')
  useEffect(() => {
    if (ids === '') return
    let current = true
    void invoke('sessions.resumable', { projectId, sessionIds: ids.split(',') }).then((result) => {
      if (!current) return
      if (result.ok) setVerdicts(result.value.verdicts)
      else console.error('sessions.resumable failed:', result.error)
    })
    return () => {
      current = false
    }
  }, [projectId, ids, liveKey])
  return verdicts
}

export interface HistoryPopoverProps {
  project: ProjectView
  onClose: () => void
}

export function HistoryPopover({ project, onClose }: HistoryPopoverProps) {
  const { live, history, error } = useClaudeHome(project.path)
  const layout = useLayout(project.id).state
  const orchestrators = useOrchestratorViews()
  const sessionNodes = useSessionNodeViews()
  useEffect(() => ensureProject(project.id), [project.id])
  const nodes = layout?.layout.nodes
  const known = useMemo((): KnownSessions => {
    const running = worfySessions({ nodes: nodes ?? [], orchestrators: Object.values(orchestrators), sessionNodes: Object.values(sessionNodes), projectId: project.id, history })
    const external = new Set<string>()
    for (const node of nodes ?? []) {
      const data = node.kind === SESSION_KIND ? readSessionNodeData(node.data) : null
      if (data !== null) external.add(data.sessionId)
    }
    return { worfy: worfySessionIds(nodes ?? [], [...running.keys()]), external }
  }, [nodes, orchestrators, sessionNodes, project.id, history])
  const rows = useMemo(() => history.slice(0, HISTORY_ROWS), [history])
  const liveKey = (live ?? []).map((session) => `${session.sessionId}:${session.status}`).join(',')
  const verdicts = useVerdicts(project.id, rows, `${liveKey}|${history.length}`)
  const [problem, setProblem] = useState<{ sessionId: string; text: string } | null>(null)
  // On a read-only screen (worfy-link ticket 25) Resume is inactive, and so is Show where it would
  // put a Node on the Canvas; a Node already shown is only focused.
  const readOnly = useReadOnly()
  // The history is read once per Project; Sessions that ended since then are read when it opens.
  useEffect(() => refreshClaudeHome(project.path), [project.path])

  const focus = (nodeId: string) => {
    setView('canvas')
    focusSessionNode(project.id, nodeId)
    onClose()
  }

  const show = async (session: HistorySession) => {
    const nodes = layout?.layout.nodes ?? []
    const existing = nodes.find((node) => node.data.sessionId === session.sessionId)
    if (existing) {
      // An archived or hidden Node comes back first, as one step ⌘Z undoes (canvas/show-node.ts).
      await showNode(project.id, existing)
      focus(existing.id)
      return
    }
    const op = showSessionNodeOp(session, nodes, project.path)
    await applyLayoutOp(project.id, op)
    focus(op.node.id ?? '')
  }

  const resume = async (session: HistorySession) => {
    setProblem(null)
    const result = await invoke('sessions.resume', { projectId: project.id, sessionId: session.sessionId })
    if (result.ok) focus(result.value.nodeId)
    else setProblem({ sessionId: session.sessionId, text: result.error })
  }

  let body
  if (error !== undefined) body = <p style={styles.message}>The history could not be read: {error}</p>
  else if (rows.length === 0) body = <p style={styles.message}>No Sessions in this Project yet</p>
  else
    body = (
      <ul style={styles.list}>
        {rows.map((session) => {
          const verdict = verdicts[session.sessionId]
          const title = session.title ?? `Session ${session.sessionId.slice(0, 8)}`
          const refused = verdict !== undefined && !verdict.resumable ? verdict.label : null
          const why = problem?.sessionId === session.sessionId ? problem.text : refused
          const onCanvas = layout?.layout.nodes.find((node) => node.data.sessionId === session.sessionId)
          const showWrites = onCanvas === undefined || !shownOnCanvas(onCanvas)
          return (
            <li key={session.sessionId} style={styles.row} data-testid="history-session" data-session-id={session.sessionId}>
              <div style={styles.top}>
                <span style={styles.title} title={title}>
                  {title}
                </span>
                <button type="button" style={styles.button} data-testid="history-show" {...writeAction(showWrites ? readOnly : null, () => void show(session))}>
                  Show
                </button>
                <button
                  type="button"
                  style={verdict?.resumable === true ? styles.button : { ...styles.button, opacity: 0.45 }}
                  data-testid="history-resume"
                  disabled={verdict === undefined || !verdict.resumable}
                  {...writeAction(readOnly, () => void resume(session), refused ?? 'Continue this Session in worfy')}
                >
                  Resume
                </button>
              </div>
              <div style={styles.meta}>
                <span data-testid="history-source">{historySource(session, known)}</span>
                <span>{when(session.lastAt, session.modifiedAt)}</span>
                {session.gitBranch !== undefined ? (
                  <span className="w-mono" data-testid="history-branch">
                    {session.gitBranch}
                  </span>
                ) : null}
              </div>
              {why !== null ? (
                <div style={styles.why} data-testid="history-resume-why">
                  {why}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    )

  return (
    <div
      role="dialog"
      aria-label="History"
      style={styles.root}
      data-testid="history-popover"
      // Esc pressed with the focus inside the popover closes it, as the dialogs of the sidebar do,
      // and only it: the press goes no further, so an ADR panel open next to it stays.
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div style={styles.header}>
        <h3 style={styles.heading}>History</h3>
        <button type="button" style={styles.button} onClick={onClose}>
          Close
        </button>
      </div>
      {body}
    </div>
  )
}
