import type { CSSProperties } from 'react'
import { NodeResizer } from '@xyflow/react'
import type { SessionState } from '../../../shared/agent/events'
import { readOrchestratorData } from '../../../shared/ipc/orchestrator'
import { StatusChip, type Status } from '../../theme/primitives'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'

// The Orchestrator: the Project's main Session (CONTEXT.md, «Оркестратор»), collapsed to a Node.
// main creates it locked (it can be moved and resized, not removed) and keeps its data current:
// state, model, cost and the last status block of the Session's answers, shown verbatim
// (src/main/agent/orchestrator.ts). The Session view with the transcript is ticket 33.
export const kind = 'orchestrator'
export const defaultWidth = 360
export const defaultHeight = 200

const CHIPS: Record<SessionState, { status: Status; label: string }> = {
  starting: { status: 'working', label: 'starting' },
  busy: { status: 'working', label: 'busy' },
  idle: { status: 'ready', label: 'idle' },
  needs_permission: { status: 'blocked', label: 'needs permission' },
  error: { status: 'blocked', label: 'error' },
  closed: { status: 'done', label: 'closed' },
}

/** Dollars with cents, or with four decimals below a dollar, where a turn costs fractions of a cent. */
function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`
}

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
  title: { fontSize: 'var(--text-15)', fontWeight: 600, color: 'var(--text)', marginRight: 'auto' },
  meta: {
    flex: 'none',
    display: 'flex',
    gap: 'var(--space-3)',
    padding: 'var(--space-1) var(--space-3) 0',
    fontSize: 'var(--text-12)',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  block: {
    flex: 1,
    minHeight: 0,
    margin: 0,
    padding: 'var(--space-2) var(--space-3)',
    overflow: 'auto',
    fontSize: 'var(--text-12)',
    lineHeight: '17px',
    color: 'var(--text)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
    cursor: 'text',
  },
  empty: { padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
} satisfies Record<string, CSSProperties>

export default function OrchestratorNode({ id, data, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const orchestrator = readOrchestratorData(data.node.data)
  const chip = CHIPS[orchestrator.state ?? 'starting']

  return (
    <div className="w-node-surface" style={styles.root} data-testid="orchestrator-node" data-node-id={id}>
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={120}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div className="w-orchestrator__header" style={styles.header}>
        <span style={styles.title}>Orchestrator</span>
        <span data-testid="orchestrator-state" title={orchestrator.error ?? undefined}>
          <StatusChip status={chip.status} label={chip.label} />
        </span>
      </div>
      <div style={styles.meta}>
        <span className="w-mono" data-testid="orchestrator-model">
          {orchestrator.model ?? '—'}
        </span>
        <span className="w-mono" data-testid="orchestrator-cost" title="Cost of this Session">
          {formatCost(orchestrator.costUsd ?? 0)}
        </span>
      </div>
      {orchestrator.statusBlock ? (
        <pre className="w-mono nodrag nowheel" style={styles.block} data-testid="orchestrator-status-block">
          {orchestrator.statusBlock}
        </pre>
      ) : (
        <div style={styles.empty} data-testid="orchestrator-status-block-empty">
          No status block yet
        </div>
      )}
    </div>
  )
}
