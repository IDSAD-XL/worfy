import { Fragment, useState, type CSSProperties } from 'react'
import type { ORCHESTRATOR_HEIGHT, ORCHESTRATOR_KIND, ORCHESTRATOR_WIDTH } from '../../../shared/ipc/orchestrator'
import { invoke } from '../../ipc'
import { writeAction } from '../../projects/read-only'
import { useReadOnly } from '../../projects/useProjects'
import { openSession } from '../../session/navigation'
import { formatCost, STATE_CHIPS } from '../../session/format'
import { StatusChip } from '../../theme/primitives'
import { KindBand, KindIcon } from '../kind-icons'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { useLayoutOps } from '../useLayout'
import { NODE_HEADER, NODE_TITLE } from '../zoom-level'
import type { CanvasNodeProps } from './index'
import { useOrchestratorView } from './orchestrator-view'

// The Orchestrator: the Project's main Session (CONTEXT.md, "Orchestrator"), collapsed to a Node.
// main creates it locked (it can be moved and resized, not removed). What it shows — state, model,
// cost and the last status block of the Session's answers, verbatim — is main's view of the
// Orchestrator (src/main/agent/orchestrator.ts), asked for once and then followed on
// `orchestrator.changed` (orchestrator-view.ts). A double click opens the Session view on its
// Session (src/renderer/session/SessionView.tsx). "New conversation" (ticket 18) sends the current
// Session to the history and makes a new one the Orchestrator; it waits for the turn to end.
//
// main creates the Node with the kind and size of src/shared/ipc/orchestrator.ts. The registry
// (index.ts) needs them here as literals (fast refresh accepts no other constant exports);
// `satisfies` fails the typecheck the moment they differ from the shared ones.
export const kind = 'orchestrator' satisfies typeof ORCHESTRATOR_KIND
export const defaultWidth = 360 satisfies typeof ORCHESTRATOR_WIDTH
export const defaultHeight = 200 satisfies typeof ORCHESTRATOR_HEIGHT
export const minimapColor = 'var(--kind-orchestrator)'

const styles = {
  root: { width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  // The kind band and icon of the Orchestrator, on the pale ground of its kind (kind-icons.tsx,
  // ADR-0077); its surface has a double border (node-chrome.css), so the kind shows not only by colour.
  header: {
    position: 'relative',
    flex: 'none',
    height: 'var(--row-height)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: '0 var(--space-3)',
    borderBottom: '1px solid var(--border)',
    background: 'var(--kind-orchestrator-tint)',
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
  // The four lines of the status block, one row each (ticket 27): a wrapped block of four long
  // lines did not fit the Node of the default size, and the fourth label (Waiting) needed a scroll. A row too long
  // for the Node is cut with an ellipsis; the whole line is its title and stays in the Session view.
  // The block still scrolls when the Node is resized below four rows.
  block: {
    flex: 1,
    minHeight: 0,
    padding: 'var(--space-2) var(--space-3)',
    overflow: 'auto',
    fontSize: 'var(--text-12)',
    lineHeight: '17px',
    color: 'var(--text)',
    userSelect: 'text',
    cursor: 'text',
  },
  line: { whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' },
  empty: { padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
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
  problem: { padding: '0 var(--space-3)', fontSize: 'var(--text-11)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

export default function OrchestratorNode({ id, selected }: CanvasNodeProps) {
  const ops = useLayoutOps()
  const view = useOrchestratorView(id)
  const chip = STATE_CHIPS[view?.state ?? 'starting']
  const busy = view?.state === 'busy'
  const readOnly = useReadOnly()
  const [problem, setProblem] = useState<string | null>(null)

  const newConversation = () => {
    if (!view) return
    setProblem(null)
    void invoke('orchestrator.newConversation', { projectId: view.projectId }).then((result) => {
      if (!result.ok) setProblem(result.error)
    })
  }

  return (
    <div
      className="w-node-surface w-node-surface--double"
      style={styles.root}
      role="group"
      aria-label="Orchestrator"
      data-testid="orchestrator-node"
      data-node-id={id}
      onDoubleClick={() => {
        if (view) openSession({ nodeId: id, projectId: view.projectId })
      }}
    >
      <NodeResizeClamp
        isVisible={selected}
        minWidth={240}
        minHeight={120}
        onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })}
      />
      <div className="w-orchestrator__header" style={styles.header} title="Double-click to open the Session" {...NODE_HEADER}>
        <KindBand kind="orchestrator" />
        <KindIcon kind="orchestrator" />
        <span style={styles.title} {...NODE_TITLE}>
          Orchestrator
        </span>
        <span data-testid="orchestrator-state" title={view?.error ?? undefined}>
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <button
          type="button"
          className="nodrag"
          style={styles.tool}
          data-testid="orchestrator-new-conversation"
          disabled={!view || busy}
          {...writeAction(readOnly, newConversation, busy ? 'Interrupt the turn first' : 'Send this Session to the history and start a new one')}
        >
          New conversation
        </button>
      </div>
      {problem !== null ? (
        <div style={styles.problem} role="alert">
          {problem}
        </div>
      ) : null}
      <div style={styles.meta}>
        <span className="w-mono" data-testid="orchestrator-model">
          {view?.model ?? '—'}
        </span>
        <span className="w-mono" data-testid="orchestrator-cost" title="Cost of this Session">
          {view ? formatCost(view.costUsd) : '—'}
        </span>
      </div>
      {view?.statusBlock ? (
        <div className="w-mono nodrag nowheel" style={styles.block} data-testid="orchestrator-status-block">
          {view.statusBlock.split('\n').map((line, index) => (
            // The \n between rows keeps the block's text verbatim for copying; the block's normal
            // white-space collapses it, so it draws nothing between the rows.
            <Fragment key={index}>
              {index > 0 ? '\n' : null}
              <div style={styles.line} title={line} data-testid="orchestrator-status-line">
                {line}
              </div>
            </Fragment>
          ))}
        </div>
      ) : (
        <div style={styles.empty} data-testid="orchestrator-status-block-empty">
          No status block yet
        </div>
      )}
    </div>
  )
}
