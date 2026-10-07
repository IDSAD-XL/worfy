import type { CSSProperties } from 'react'
import { subagentTypeLabel } from '../../../shared/agent/subagent-type'
import { flattenSubagents, type SubagentInfo } from '../../../shared/transcript/subagents'
import { statusLabel, useSubagentTree, useTick } from '../../claude-home/subagents'
import { useProjects } from '../../projects/useProjects'
import { StatusChip, type Status } from '../../theme/primitives'
import { openSession } from '../navigation'
import type { RailBlockProps } from './index'

// The Subagent tree in the Session rail (ticket 15): the same tree as the Subagent Nodes on the
// Canvas (canvas/sources/subagents.ts), as a list — each Subagent indented under the one that
// started it, with its status, how long it has run and a reviewer's verdict. Nothing is folded
// here. A click on a row opens the Subagent's transcript, read-only.

// After the Binding (ticket 16), before the Limits.
export const order = 20

const CHIP: Record<SubagentInfo['status'], Status> = { running: 'working', done: 'done', error: 'blocked' }

const styles = {
  heading: { margin: 0, fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' },
  card: { marginTop: 6, padding: '4px 0', border: '1px solid var(--border)', borderRadius: 'var(--radius-node)', background: 'var(--surface)' },
  empty: { display: 'block', padding: '6px 10px', fontSize: 'var(--text-12)', color: 'var(--text-muted)' },
  list: { margin: 0, padding: 0, listStyle: 'none' },
  row: {
    width: '100%',
    minHeight: 'var(--row-height)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 10px',
    border: 0,
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  branch: { flex: 'none', color: 'var(--text-muted)' },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
} satisfies Record<string, CSSProperties>

export interface SubagentsListProps {
  tree: readonly SubagentInfo[]
  now: number
  onOpen: (info: SubagentInfo) => void
}

/** The list for a tree at `now`; exported for tests, which pass their own tree. */
export function SubagentsList({ tree, now, onOpen }: SubagentsListProps) {
  const rows = flattenSubagents(tree)
  return (
    <div data-testid="subagents-rail">
      <h2 style={styles.heading}>Subagents</h2>
      <div style={styles.card}>
        {rows.length === 0 ? (
          <span style={styles.empty}>No Subagents yet</span>
        ) : (
          <ul style={styles.list}>
            {rows.map((info) => {
              const canOpen = info.agentId !== null && info.transcript
              return (
                <li key={info.id}>
                  <button
                    type="button"
                    style={{ ...styles.row, paddingLeft: 10 + (info.depth - 1) * 14, cursor: canOpen ? 'pointer' : 'default' }}
                    disabled={!canOpen}
                    title={info.summary ?? info.description ?? undefined}
                    data-testid="subagents-rail-row"
                    data-subagent-id={info.agentId ?? undefined}
                    data-status={info.status}
                    onClick={() => onOpen(info)}
                  >
                    <span className="w-mono" style={styles.branch} aria-hidden="true">
                      {info.depth > 1 ? '└' : '•'}
                    </span>
                    <span className="w-mono" style={styles.name} title={info.subagentType ?? undefined} data-testid="subagents-rail-name">
                      {info.name ?? subagentTypeLabel(info.subagentType) ?? 'Subagent'}
                      {info.name !== null && info.subagentType !== null ? <span style={{ color: 'var(--text-muted)' }}> · {subagentTypeLabel(info.subagentType)}</span> : null}
                    </span>
                    {info.verdict !== null ? <StatusChip status={info.verdict === 'VERIFIED' ? 'done' : 'blocked'} label={info.verdict} /> : null}
                    <StatusChip status={CHIP[info.status]} label={statusLabel(info, now)} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function SubagentsRail({ projectId, nodeId, sessionId, claudeSessionId }: RailBlockProps) {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const session = claudeSessionId ?? sessionId
  const tree = useSubagentTree(root, session)
  const now = useTick(flattenSubagents(tree).some((info) => info.status === 'running'))
  const open = (info: SubagentInfo) => {
    if (session === null || info.agentId === null) return
    openSession({ nodeId, projectId, external: { sessionId: session, agentId: info.agentId } })
  }
  return <SubagentsList tree={tree} now={now} onOpen={open} />
}
