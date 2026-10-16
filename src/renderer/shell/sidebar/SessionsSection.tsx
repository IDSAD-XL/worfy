import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ProjectView } from '../../../shared/ipc/projects'
import { useOrchestratorView, useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { applyLayoutOp, useLayout } from '../../canvas/useLayout'
import { focusSessionNode } from '../../claude-home/focus'
import { sessionNodeId, sessionRow, worfySessionIds, worfySessions } from '../../claude-home/session-nodes'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { invoke, readableReason } from '../../ipc'
import { writeAction } from '../../projects/read-only'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { HistoryPopover } from '../../session/HistoryPopover'
import { setView } from '../../session/navigation'
import { ensureProject, useSessionNodeViews } from '../../session/node-sessions'
import { StatusChip } from '../../theme/primitives'
import { SidebarSection } from '../SidebarSection'

/**
 * The live Sessions of the active Project, wherever they were started (design F, sidebar «Sessions»),
 * "New session" (a new live Session Node in the Project's root, ticket 18) and the Project's history
 * (session/HistoryPopover.tsx). A Session worfy runs — the Orchestrator, a Session Node's — is
 * «worfy», with the name and state its Node shows (worfy-daily ticket 24, claude-home/session-nodes.ts,
 * sessionRow); the others are «terminal» or «desktop» by where Claude Code says they were started.
 */
export const order = 30

const styles = {
  count: { fontSize: 'var(--text-11)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' },
  action: {
    flex: 'none',
    padding: '0 2px',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
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

/** Asks main for the Orchestrator's view, so its row has its state even before its Node is drawn. */
function FollowOrchestrator({ nodeId }: { nodeId: string }) {
  useOrchestratorView(nodeId)
  return null
}

function Sessions({ project }: { project: ProjectView }) {
  const { live, history, error } = useClaudeHome(project.path)
  const layout = useLayout(project.id).state
  const orchestrators = useOrchestratorViews()
  const sessionNodes = useSessionNodeViews()
  useEffect(() => ensureProject(project.id), [project.id])
  const nodes = layout?.layout.nodes
  const orchestratorNode = nodes?.find((node) => node.kind === 'orchestrator')
  const worfy = useMemo(
    () =>
      worfySessions({ nodes: nodes ?? [], orchestrators: Object.values(orchestrators), sessionNodes: Object.values(sessionNodes), projectId: project.id, history }),
    [nodes, orchestrators, sessionNodes, project.id, history],
  )
  const worfyIds = useMemo(() => worfySessionIds(nodes ?? [], [...worfy.keys()]), [nodes, worfy])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // On a read-only screen (worfy-link ticket 25) "New session" is inactive, saying why.
  const readOnly = useReadOnly()

  const newSession = async () => {
    setProblem(null)
    const result = await invoke('sessions.new', { projectId: project.id })
    if (!result.ok) {
      setProblem(result.error)
      return
    }
    setView('canvas')
    focusSessionNode(project.id, result.value.nodeId)
  }

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
  if (error !== undefined) body = <p style={styles.message}>The Sessions could not be read: {readableReason(error)}</p>
  else if (live !== undefined && live.length > 0)
    body = (
      <ul style={styles.list}>
        {live.map((session) => {
          const title = session.name ?? history.find((each) => each.sessionId === session.sessionId)?.title ?? `Session ${session.sessionId.slice(0, 8)}`
          const row = sessionRow(session, worfyIds, worfy, title)
          return (
            <li key={session.sessionId}>
              <button
                type="button"
                className="w-row"
                style={styles.row}
                data-testid="sidebar-session"
                data-session-id={session.sessionId}
                data-source={row.source}
                title={`${row.name} — ${session.cwd}`}
                onClick={() => open(session.sessionId)}
              >
                <span style={styles.name} data-testid="sidebar-session-name">
                  {row.name}
                </span>
                <span style={styles.source} data-testid="sidebar-session-source">
                  {row.source}
                </span>
                <StatusChip status={row.chip.status} label={row.chip.label} />
              </button>
            </li>
          )
        })}
      </ul>
    )

  return (
    <SidebarSection
      id="SessionsSection"
      title="Sessions"
      meta={
        <span style={styles.count} data-testid="sidebar-sessions-live">
          {live?.length ?? 0} live
        </span>
      }
      trailing={
        <>
          <button type="button" style={styles.action} data-testid="sidebar-new-session" {...writeAction(readOnly, () => void newSession(), "A new Session in the Project's root")}>
            New session
          </button>
          <button type="button" style={styles.action} data-testid="sidebar-history" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
            History
          </button>
        </>
      }
      notice={
        problem !== null ? (
          <p style={styles.message} role="alert">
            {problem}
          </p>
        ) : null
      }
      overlay={
        <>
          {orchestratorNode ? <FollowOrchestrator nodeId={orchestratorNode.id} /> : null}
          {/* Placed against the section, under its header: it opens over a collapsed section too. */}
          {historyOpen ? <HistoryPopover project={project} onClose={() => setHistoryOpen(false)} /> : null}
        </>
      }
    >
      {body}
    </SidebarSection>
  )
}

export default function SessionsSection() {
  const project = activeProject(useProjects())
  return project ? <Sessions key={project.id} project={project} /> : null
}
