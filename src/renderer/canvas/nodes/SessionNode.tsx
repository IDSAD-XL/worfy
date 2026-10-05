import { memo, type CSSProperties } from 'react'
import { NodeResizer } from '@xyflow/react'
import { readSessionNodeData, sessionSourceLabel, sessionStatus, type SESSION_HEIGHT, type SESSION_KIND, type SESSION_WIDTH } from '../../claude-home/session-nodes'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { activeProject, useProjects } from '../../projects/useProjects'
import { openSession } from '../../session/navigation'
import { StatusChip } from '../../theme/primitives'
import { badges, type SlotSubject } from '../badges'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'

// A Session of Claude Code on the Canvas (CONTEXT.md, «Сессия»: one Session — one Node, wherever it
// was started). For now these are Sessions started outside worfy — `claude` in a terminal, the
// Claude desktop app — shown read-only: where they run, their title and their status, followed
// from the registry under ~/.claude (claude-home/useClaudeHome.ts). The overlay
// overlays/SessionNodes.tsx makes the Node when the Session starts; the Node stays, «finished»,
// after the process is gone. Hiding or removing the Node changes nothing about the Session. A
// double click opens its transcript in the Session view (session/ExternalSessionPanel.tsx).
//
// The registry (index.ts) needs the kind and size here as literals; `satisfies` fails the
// typecheck the moment they differ from those of claude-home/session-nodes.ts.
export const kind = 'session' satisfies typeof SESSION_KIND
export const defaultWidth = 300 satisfies typeof SESSION_WIDTH
export const defaultHeight = 120 satisfies typeof SESSION_HEIGHT
export const minimapColor = 'var(--text-secondary)'

const styles = {
  root: { width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    flex: 'none',
    height: 'var(--row-height)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: '0 var(--space-3)',
    borderBottom: '1px solid var(--border)',
    cursor: 'grab',
  },
  title: { flex: 1, minWidth: 0, fontSize: 'var(--text-13)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2) var(--space-3)' },
  line: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  source: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  readOnly: {
    flex: 'none',
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-chip)',
    fontSize: 'var(--text-11)',
    lineHeight: '16px',
    color: 'var(--text-secondary)',
  },
  badges: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' },
  tools: { flex: 'none', display: 'flex', gap: 2 },
  tool: {
    padding: '0 4px',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-muted)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
    cursor: 'pointer',
  },
  broken: { padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

function SessionNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const info = readSessionNodeData(data.node.data)
  const project = activeProject(useProjects())
  const { live, history } = useClaudeHome(project?.path)

  if (info === null || project === undefined) {
    return (
      <div className="w-node-surface" style={styles.root} data-testid="session-node" data-node-id={id}>
        <div style={styles.broken}>This Session Node has no Session</div>
      </div>
    )
  }

  const session = live?.find((each) => each.sessionId === info.sessionId)
  const chip = live === undefined ? { status: 'ready' as const, label: '…' } : sessionStatus(session)
  const title = session?.name ?? history.find((each) => each.sessionId === info.sessionId)?.title ?? info.name ?? `Session ${info.sessionId.slice(0, 8)}`
  const subject: SlotSubject = { kind: 'session', projectId: project.id, root: project.path, sessionId: info.sessionId }

  return (
    <div
      className="w-node-surface"
      style={styles.root}
      data-testid="session-node"
      data-node-id={id}
      data-session-id={info.sessionId}
      data-status={chip.label}
      onDoubleClick={() => openSession({ nodeId: id, projectId: project.id, external: { sessionId: info.sessionId } })}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={80}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div style={styles.header} title="Double-click to open the transcript">
        <span style={styles.title} data-testid="session-node-title" title={title}>
          {title}
        </span>
        <span data-testid="session-node-status">
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="nodrag" style={styles.tools}>
          <button type="button" style={styles.tool} title="Hide the Node; the Session goes on" onClick={() => void ops.apply({ op: 'hide', id, hidden: true })}>
            Hide
          </button>
          <button type="button" style={styles.tool} title="Remove the Node; the Session goes on" onClick={() => void ops.apply({ op: 'remove', id })}>
            Remove
          </button>
        </span>
      </div>
      <div style={styles.body}>
        <div style={styles.line}>
          <span style={styles.readOnly} data-testid="session-node-read-only">
            read-only
          </span>
          <span className="w-mono" style={styles.source} data-testid="session-node-source" title={sessionSourceLabel(info)}>
            {sessionSourceLabel(info)}
          </span>
        </div>
        {badges.length ? (
          <div style={styles.badges}>
            {badges.map(({ id: badgeId, Component }) => (
              <Component key={badgeId} subject={subject} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default memo(SessionNode)
