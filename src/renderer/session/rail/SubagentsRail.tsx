import { useId, useSyncExternalStore, type CSSProperties } from 'react'
import { subagentTypeLabel } from '../../../shared/agent/subagent-type'
import { flattenSubagents, type SubagentInfo } from '../../../shared/transcript/subagents'
import { statusLabel, useSubagentTree, useTick } from '../../claude-home/subagents'
import { useProjects } from '../../projects/useProjects'
import { StatusChip, type Status } from '../../theme/primitives'
import { openSession } from '../navigation'
import type { RailBlockProps } from './index'

// The Subagent tree in the Session rail (ticket 15): the same tree as the Subagent Nodes on the
// Canvas (canvas/sources/subagents.ts), as a list — each Subagent indented under the one that
// started it, with its status, how long it has run and a reviewer's verdict. A click on a row opens
// the Subagent's transcript, read-only.
//
// The rail orders the list itself, newest first on every level (the shared tree is oldest first,
// and the Canvas places its Nodes by that order). A Subagent of the Session that is done goes, with
// everything it started, into one "Done (N)" group under the running and failed ones; the group is
// closed until opened, and stays open for that Session while the window runs (not saved to disk).
// The Canvas folds done Subagents by its own rule, under each parent.

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
  group: { color: 'var(--text-muted)' },
  chevron: { flex: 'none' },
} satisfies Record<string, CSSProperties>

/**
 * A level of the tree newest first, each Subagent followed by its own Subagents, newest first too.
 * One without a start time goes last on its level; equal times keep the tree's order.
 */
function newestFirst(level: readonly SubagentInfo[]): SubagentInfo[] {
  const sorted = [...level].sort((a, b) => (b.startedAt ?? Number.NEGATIVE_INFINITY) - (a.startedAt ?? Number.NEGATIVE_INFINITY))
  return sorted.flatMap((info) => [info, ...newestFirst(info.children)])
}

// Which Sessions have their "Done (N)" group open: for as long as the window runs, never on disk.
const openGroups = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function toggleGroup(key: string): void {
  if (!openGroups.delete(key)) openGroups.add(key)
  for (const listener of listeners) listener()
}

const chevron = (open: boolean) => (
  <svg style={styles.chevron} width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* Right while closed, down while open. */}
    <path d={open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} />
  </svg>
)

export interface SubagentsListProps {
  tree: readonly SubagentInfo[]
  now: number
  onOpen: (info: SubagentInfo) => void
  /** The Session the list belongs to: whether its "Done (N)" group is open is kept per Session. */
  sessionKey: string
}

/** The list for a tree at `now`; exported for tests, which pass their own tree. */
export function SubagentsList({ tree, now, onOpen, sessionKey }: SubagentsListProps) {
  const groupId = useId()
  const open = useSyncExternalStore(subscribe, () => openGroups.has(sessionKey))
  const done = tree.filter((info) => info.status === 'done')
  const active = newestFirst(tree.filter((info) => info.status !== 'done'))
  const row = (info: SubagentInfo) => {
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
  }
  return (
    <div data-testid="subagents-rail">
      <h2 style={styles.heading}>Subagents</h2>
      <div style={styles.card}>
        {tree.length === 0 ? (
          <span style={styles.empty}>No Subagents yet</span>
        ) : (
          <>
            {active.length > 0 ? <ul style={styles.list}>{active.map(row)}</ul> : null}
            {done.length > 0 ? (
              <>
                <button
                  type="button"
                  style={{ ...styles.row, ...styles.group }}
                  aria-expanded={open}
                  aria-controls={groupId}
                  data-testid="subagents-rail-done"
                  onClick={() => toggleGroup(sessionKey)}
                >
                  {chevron(open)}
                  Done <span className="w-mono">({done.length})</span>
                </button>
                <ul id={groupId} style={styles.list} hidden={!open}>
                  {open ? newestFirst(done).map(row) : null}
                </ul>
              </>
            ) : null}
          </>
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
  return <SubagentsList tree={tree} now={now} onOpen={open} sessionKey={`${projectId}/${session ?? nodeId}`} />
}
