import type { CSSProperties } from 'react'
import type { ProjectView } from '../../../shared/ipc/projects'
import { applyLayoutOp, useLayout } from '../../canvas/useLayout'
import { focusSessionNode } from '../../claude-home/focus'
import { sessionNodeId, sessionStatus } from '../../claude-home/session-nodes'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { activeProject, useProjects } from '../../projects/useProjects'
import { setView } from '../../session/navigation'
import { StatusChip } from '../../theme/primitives'

/** The live Sessions of the active Project, wherever they were started (design F, sidebar «Sessions»). */
export const order = 30

const styles = {
  header: { display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 8px' },
  heading: { margin: 0, fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' },
  count: { fontSize: 'var(--text-11)', color: 'var(--text-secondary)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  message: { margin: '2px 8px 4px', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--text-muted)', overflowWrap: 'anywhere' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    height: 'var(--row-height)',
    padding: '0 8px',
    boxSizing: 'border-box',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-13)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  source: { flex: 'none', fontSize: 'var(--text-11)', color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

function Sessions({ project }: { project: ProjectView }) {
  const { live, history, error } = useClaudeHome(project.path)
  const layout = useLayout(project.id).state

  // The Node of a Session: the one that names it (worfy's own, e.g. the Orchestrator), else its Session Node.
  const nodeOf = (sessionId: string) => layout?.layout.nodes.find((node) => node.data.sessionId === sessionId) ?? layout?.layout.nodes.find((node) => node.id === sessionNodeId(sessionId))

  const open = (sessionId: string) => {
    const node = nodeOf(sessionId)
    if (!node) return
    setView('canvas')
    const shown = node.hidden ? applyLayoutOp(project.id, { op: 'hide', id: node.id, hidden: false }) : Promise.resolve(undefined)
    void shown.then(() => focusSessionNode(project.id, node.id))
  }

  let body = null
  if (error !== undefined) body = <p style={styles.message}>The Sessions could not be read: {error}</p>
  else if (live !== undefined && live.length > 0)
    body = (
      <ul style={styles.list}>
        {live.map((session) => {
          const title = session.name ?? history.find((each) => each.sessionId === session.sessionId)?.title ?? `Session ${session.sessionId.slice(0, 8)}`
          const chip = sessionStatus(session)
          return (
            <li key={session.sessionId}>
              <button
                type="button"
                className="w-row"
                style={styles.row}
                data-testid="sidebar-session"
                data-session-id={session.sessionId}
                title={`${title} — ${session.cwd}`}
                onClick={() => open(session.sessionId)}
              >
                <span style={styles.name}>{title}</span>
                <span style={styles.source}>{session.entrypoint === 'claude-desktop' ? 'desktop' : 'terminal'}</span>
                <StatusChip status={chip.status} label={chip.label} />
              </button>
            </li>
          )
        })}
      </ul>
    )

  return (
    <section aria-label="Sessions">
      <div style={styles.header}>
        <h2 style={styles.heading}>Sessions</h2>
        <span style={styles.count} data-testid="sidebar-sessions-live">
          {live?.length ?? 0} live
        </span>
      </div>
      {body}
    </section>
  )
}

export default function SessionsSection() {
  const project = activeProject(useProjects())
  return project ? <Sessions key={project.id} project={project} /> : null
}
