import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { HistorySession } from '../../shared/ipc/claude-home'
import type { ProjectView } from '../../shared/ipc/projects'
import type { ResumeVerdict } from '../../shared/ipc/sessions'
import { applyLayoutOp, useLayout } from '../canvas/useLayout'
import { focusSessionNode } from '../claude-home/focus'
import { showSessionNodeOp } from '../claude-home/session-nodes'
import { refreshClaudeHome, useClaudeHome } from '../claude-home/useClaudeHome'
import { invoke } from '../ipc'
import { setView } from './navigation'

// The history of a Project (ticket 18): every Session the Project's transcripts record, wherever
// it was started — newest first, with its title, where it was started, when it last changed and
// its branch (claude-home/useClaudeHome.ts reads them from ~/.claude). "Show" puts a read-only Node
// for it on the Canvas, or goes to the Node it has. "Resume" continues it in worfy on its Node
// (`sessions.resume`, src/main/agent/node-sessions.ts); main's rule of Resume
// (src/main/agent/resume.ts) also decides which rows offer it, and the row says why not.

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
    cursor: 'pointer',
  },
  message: { margin: 4, fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

/** Where a Session was started, as its transcript's `entrypoint` says. */
function historySource(entrypoint: string | undefined): string {
  if (entrypoint === undefined) return '—'
  if (entrypoint === 'cli') return 'terminal'
  if (entrypoint === 'claude-desktop') return 'desktop'
  if (entrypoint.startsWith('sdk')) return 'worfy'
  return entrypoint
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
  const rows = useMemo(() => history.slice(0, HISTORY_ROWS), [history])
  const liveKey = (live ?? []).map((session) => `${session.sessionId}:${session.status}`).join(',')
  const verdicts = useVerdicts(project.id, rows, `${liveKey}|${history.length}`)
  const [problem, setProblem] = useState<{ sessionId: string; text: string } | null>(null)
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
      if (existing.hidden) await applyLayoutOp(project.id, { op: 'hide', id: existing.id, hidden: false })
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
          return (
            <li key={session.sessionId} style={styles.row} data-testid="history-session" data-session-id={session.sessionId}>
              <div style={styles.top}>
                <span style={styles.title} title={title}>
                  {title}
                </span>
                <button type="button" style={styles.button} data-testid="history-show" onClick={() => void show(session)}>
                  Show
                </button>
                <button
                  type="button"
                  style={verdict?.resumable === true ? styles.button : { ...styles.button, opacity: 0.45, cursor: 'default' }}
                  data-testid="history-resume"
                  disabled={verdict === undefined || !verdict.resumable}
                  title={refused ?? 'Continue this Session in worfy'}
                  onClick={() => void resume(session)}
                >
                  Resume
                </button>
              </div>
              <div style={styles.meta}>
                <span data-testid="history-source">{historySource(session.entrypoint)}</span>
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
    <div role="dialog" aria-label="History" style={styles.root} data-testid="history-popover">
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
