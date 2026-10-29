import { useId, useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import { subagentTypeLabel } from '../../../shared/agent/subagent-type'
import { flattenSubagents, type SubagentInfo } from '../../../shared/transcript/subagents'
import {
  finishedIds,
  folds,
  hiddenIdsOf,
  hideSubagents,
  INTERRUPTED_TOOLTIP,
  showHiddenSubagents,
  statusLabel,
  useHiddenSubagents,
  useSubagentTree,
  useTick,
  withoutHidden,
} from '../../claude-home/subagents'
import { useProjects, useReadOnly } from '../../projects/useProjects'
import { StatusChip, type Status } from '../../theme/primitives'
import { openSession } from '../navigation'
import type { RailBlockProps } from './index'

// The Subagent tree in the Session rail (ticket 15): the same tree as the Subagent Nodes on the
// Canvas (canvas/sources/subagents.ts), as a list — each Subagent indented under the one that
// started it, with its status, how long it has run and a reviewer's verdict. A click on a row opens
// the Subagent's transcript, read-only.
//
// The rail orders the list itself, newest first on every level (the shared tree is oldest first,
// and the Canvas places its Nodes by that order). A Subagent of the Session that is done or
// interrupted goes, with everything it started, into one "Done (N)" group under the running and
// failed ones; the group is closed until opened, and stays open for that Session while the window
// runs (not saved to disk). The Canvas folds them by its own rule, under each parent.
//
// "Hide" on a row hides that entry, of any status; "Hide" by the group ("Hide finished") hides
// every entry of the Session that has ended — done, error, interrupted. main keeps the hidden entries in the
// Project's data folder, and «Show hidden Subagents» under the list brings them back (ADR-0085).
// A read-only screen shows none of the three: they write.

// After the Binding (ticket 16), last in the rail.
export const order = 20

const CHIP: Record<SubagentInfo['status'], Status> = { running: 'working', done: 'done', error: 'blocked', interrupted: 'stopped' }

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
  },
  branch: { flex: 'none', color: 'var(--text-muted)' },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  group: { color: 'var(--text-muted)' },
  chevron: { flex: 'none' },
  line: { display: 'flex', alignItems: 'center' },
  hide: {
    flex: 'none',
    marginRight: 6,
    padding: '0 6px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    font: 'inherit',
    fontSize: 'var(--text-11)',
    lineHeight: '16px',
  },
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
  /** Hides entries by id; without it (a read-only screen) no Hide button shows. */
  onHide?: ((ids: string[]) => void) | undefined
  /** How many entries of the Session are hidden, and how to show them again. */
  hiddenCount?: number
  onShowHidden?: (() => void) | undefined
}

/** The list for a tree at `now`; exported for tests, which pass their own tree. */
export function SubagentsList({ tree, now, onOpen, sessionKey, onHide, hiddenCount = 0, onShowHidden }: SubagentsListProps) {
  const groupId = useId()
  const open = useSyncExternalStore(subscribe, () => openGroups.has(sessionKey))
  const done = tree.filter(folds)
  const active = newestFirst(tree.filter((info) => !folds(info)))
  const finished = finishedIds(tree)
  const interrupted = done.filter((info) => info.status === 'interrupted').length
  const row = (info: SubagentInfo) => {
    const canOpen = info.agentId !== null && info.transcript
    return (
      <li key={info.id} style={styles.line}>
        <button
          type="button"
          style={{ ...styles.row, flex: 1, minWidth: 0, paddingLeft: 10 + (info.depth - 1) * 14 }}
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
          <span title={info.status === 'interrupted' ? INTERRUPTED_TOOLTIP : undefined} data-testid="subagents-rail-status">
            <StatusChip status={CHIP[info.status]} label={statusLabel(info, now)} />
          </span>
        </button>
        {onHide ? (
          <button type="button" style={styles.hide} title="Hide this Subagent from the rail and the Canvas" data-testid="subagents-rail-hide" onClick={() => onHide([info.id])}>
            Hide
          </button>
        ) : null}
      </li>
    )
  }
  return (
    <div data-testid="subagents-rail">
      <h2 style={styles.heading}>Subagents</h2>
      <div style={styles.card}>
        {tree.length === 0 ? (
          <span style={styles.empty}>{hiddenCount > 0 ? 'Every Subagent is hidden' : 'No Subagents yet'}</span>
        ) : (
          <>
            {active.length > 0 ? <ul style={styles.list}>{active.map(row)}</ul> : null}
            {done.length > 0 ? (
              <>
                <div style={styles.line}>
                  <button
                    type="button"
                    style={{ ...styles.row, ...styles.group, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' }}
                    aria-expanded={open}
                    aria-controls={groupId}
                    data-testid="subagents-rail-done"
                    onClick={() => toggleGroup(sessionKey)}
                  >
                    {chevron(open)}
                    Done <span className="w-mono">({done.length})</span>
                    {interrupted > 0 ? <span className="w-mono"> · {interrupted} interrupted</span> : null}
                  </button>
                  {onHide ? (
                    <button
                      type="button"
                      style={styles.hide}
                      title="Hide finished: every Subagent of this Session that has ended — done, error and interrupted; running ones stay"
                      data-testid="subagents-rail-hide-finished"
                      onClick={() => onHide(finished)}
                    >
                      Hide
                    </button>
                  ) : null}
                </div>
                <ul id={groupId} style={styles.list} hidden={!open}>
                  {open ? newestFirst(done).map(row) : null}
                </ul>
              </>
            ) : null}
          </>
        )}
        {hiddenCount > 0 && onShowHidden ? (
          <button type="button" style={{ ...styles.row, ...styles.group }} data-testid="subagents-rail-show-hidden" onClick={onShowHidden}>
            Show hidden Subagents <span className="w-mono">({hiddenCount})</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function SubagentsRail({ projectId, nodeId, sessionId, claudeSessionId }: RailBlockProps) {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const session = claudeSessionId ?? sessionId
  const all = useSubagentTree(root, session)
  const hidden = useHiddenSubagents(projectId)
  const hiddenIds = useMemo(() => hiddenIdsOf(hidden, session), [hidden, session])
  const tree = useMemo(() => withoutHidden(all, hiddenIds), [all, hiddenIds])
  const readOnly = useReadOnly()
  const now = useTick(flattenSubagents(tree).some((info) => info.status === 'running'))
  const open = (info: SubagentInfo) => {
    if (session === null || info.agentId === null) return
    openSession({ nodeId, projectId, external: { sessionId: session, agentId: info.agentId } })
  }
  const writes = readOnly === null && session !== null
  return (
    <SubagentsList
      tree={tree}
      now={now}
      onOpen={open}
      sessionKey={`${projectId}/${session ?? nodeId}`}
      onHide={writes ? (ids) => void hideSubagents(projectId, session, ids) : undefined}
      hiddenCount={hiddenIds.size}
      onShowHidden={writes ? () => void showHiddenSubagents(projectId, session) : undefined}
    />
  )
}
