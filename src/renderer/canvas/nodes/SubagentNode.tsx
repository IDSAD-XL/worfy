import { memo, type CSSProperties } from 'react'
import { Handle, Position } from '@xyflow/react'
import { subagentTypeLabel } from '../../../shared/agent/subagent-type'
import { statusLabel, useTick } from '../../claude-home/subagents'
import { openSession } from '../../session/navigation'
import { StatusChip, type Status } from '../../theme/primitives'
import type { NodeKindColour } from '../kind-colours'
import { KindBand, KindIcon } from '../kind-icons'
import { NODE_HEADER } from '../node-header'
import { SUBAGENT_HEIGHT, SUBAGENT_WIDTH, toggleDoneSubagents, type SubagentNodeData, type SubagentSummary, type SUBAGENT_KIND } from '../sources/subagents'
import type { CanvasNodeProps } from './index'

// A Subagent of a Session on the Canvas (ticket 15; CONTEXT.md, «Subagent»): its name, type and
// model, its status with the time it has run, and the first line of its final answer — a
// reviewer's VERIFIED or REJECTED as a chip. The Nodes come from sources/subagents.ts, to the right
// of their Session's Node; the same kind draws the "N done" row that folds a parent's done
// Subagents (a click opens it) and the invisible anchor the tree's lines start from. A click on
// "Transcript" opens the Subagent's own transcript, read-only, in the Session view.
//
// The registry (index.ts) needs the kind and size here as literals; `satisfies` fails the
// typecheck the moment they differ from those of sources/subagents.ts.
export const kind = 'subagent' satisfies typeof SUBAGENT_KIND
export const defaultWidth = 260 satisfies typeof SUBAGENT_WIDTH
export const defaultHeight = 84 satisfies typeof SUBAGENT_HEIGHT
// Drawn as an outline in this colour, without a fill (overlays/minimap-paint.ts, OUTLINED_KINDS; ADR-0077).
/** Its kind colour on the band, the icon and the minimap (kind-colours.ts). */
export const kindColour: NodeKindColour = 'subagent'

const styles = {
  root: { width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  // A dashed kind band and the kind icon, in the Session's colour; no tinted ground (kind-icons.tsx, ADR-0077).
  header: { position: 'relative', flex: 'none', height: 26, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-2) 0 var(--space-3)', cursor: 'grab' },
  name: { flex: 1, minWidth: 0, fontSize: 'var(--text-13)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 var(--space-3) var(--space-2)' },
  line: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0, fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
  clip: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  open: {
    flex: 'none',
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
    lineHeight: '16px',
  },
  fold: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: '0 var(--space-3)',
    border: '1px dashed var(--border-strong)',
    borderRadius: 'var(--radius-node)',
    background: 'var(--surface)',
    color: 'var(--text-secondary)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
  },
  handle: { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, pointerEvents: 'none' },
} satisfies Record<string, CSSProperties>

const CHIP: Record<SubagentSummary['status'], Status> = { running: 'working', done: 'done', error: 'blocked' }

function AgentNode({ id, data, agent }: { id: string; data: SubagentNodeData; agent: SubagentSummary }) {
  const now = useTick(agent.status === 'running')
  const type = subagentTypeLabel(agent.subagentType)
  const title = agent.name ?? type ?? 'Subagent'
  const kindLine = [type, agent.model].filter((part) => part !== null).join(' · ')
  const canOpen = agent.agentId !== null && agent.transcript
  // The verdict has its chip; the line shows the rest of the answer's first line, or what the Subagent was asked.
  const summaryText = agent.summary === null ? (agent.description ?? '') : agent.summary === agent.verdict ? '' : agent.summary
  const open = () => {
    if (agent.agentId === null) return
    openSession({ nodeId: data.sessionNodeId, projectId: data.projectId, external: { sessionId: data.sessionId, agentId: agent.agentId } })
  }
  return (
    <div
      className="w-node-surface"
      style={styles.root}
      role="group"
      aria-label={`Subagent ${title}`}
      data-testid="subagent-node"
      data-node-id={id}
      data-subagent-id={agent.agentId ?? undefined}
      data-status={agent.status}
      title={agent.description ?? undefined}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={styles.handle} />
      <div style={styles.header} {...NODE_HEADER}>
        <KindBand kind="subagent" />
        <KindIcon kind="subagent" />
        <span className="w-mono" style={styles.name} data-testid="subagent-name" title={agent.name === null ? (agent.subagentType ?? undefined) : undefined}>
          {title}
        </span>
        <span data-testid="subagent-status">
          <StatusChip status={CHIP[agent.status]} label={statusLabel(agent, now)} />
        </span>
      </div>
      <div style={styles.body}>
        <div style={styles.line}>
          <span className="w-mono" style={styles.clip} data-testid="subagent-kind" title={agent.subagentType ?? undefined}>
            {kindLine || '—'}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="nodrag"
            style={{ ...styles.open, opacity: canOpen ? 1 : 0.5 }}
            disabled={!canOpen}
            title={canOpen ? 'Open the transcript of this Subagent' : 'No transcript of this Subagent yet'}
            data-testid="subagent-open"
            onClick={open}
          >
            Transcript
          </button>
        </div>
        <div style={styles.line} data-testid="subagent-summary">
          {agent.verdict !== null ? (
            <span data-testid="subagent-verdict">
              <StatusChip status={agent.verdict === 'VERIFIED' ? 'done' : 'blocked'} label={agent.verdict} />
            </span>
          ) : null}
          <span style={styles.clip} title={agent.summary ?? undefined}>
            {summaryText}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} style={styles.handle} />
    </div>
  )
}

function SubagentNode({ id, data }: CanvasNodeProps) {
  const info = data.node.data as SubagentNodeData
  if (info.variant === 'anchor') {
    return (
      <div style={{ width: 1, height: 1, pointerEvents: 'none' }} aria-hidden="true">
        <Handle type="source" position={Position.Right} isConnectable={false} style={styles.handle} />
      </div>
    )
  }
  if (info.variant === 'fold' && info.fold) {
    const { count, expanded, parentKey } = info.fold
    return (
      <>
        <Handle type="target" position={Position.Left} isConnectable={false} style={styles.handle} />
        <button
          type="button"
          className="nodrag"
          style={styles.fold}
          data-testid="subagent-fold"
          data-node-id={id}
          aria-expanded={expanded}
          onClick={() => toggleDoneSubagents(info.projectId, info.sessionId, parentKey)}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d={expanded ? 'M3.5 6l4.5 4.5L12.5 6' : 'M6 3.5l4.5 4.5L6 12.5'} />
          </svg>
          <span className="w-mono">{count} done</span>
        </button>
      </>
    )
  }
  if (!info.agent) return null
  return <AgentNode id={id} data={info} agent={info.agent} />
}

export default memo(SubagentNode)
