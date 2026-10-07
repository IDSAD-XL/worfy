import type { CSSProperties } from 'react'
import { subagentTypeLabel } from '../../shared/agent/subagent-type'
import { flattenSubagents } from '../../shared/transcript/subagents'
import { readSessionNodeData, sessionStatus } from '../claude-home/session-nodes'
import { useLayout } from '../canvas/useLayout'
import { useSubagentTree } from '../claude-home/subagents'
import { useClaudeHome, useSessionTranscript } from '../claude-home/useClaudeHome'
import { useProjects } from '../projects/useProjects'
import { StatusChip, type Status } from '../theme/primitives'
import type { RailBlock } from './rail/index'
import { SessionRail } from './SessionRail'
import { Transcript } from './Transcript'
import './session.css'

// The Session view of a Session started outside worfy (a terminal, Claude desktop): the same
// transcript as a live Session, its events read from the Session's transcript file under ~/.claude
// and followed as Claude Code appends to it (claude-home/useClaudeHome.ts). worfy cannot write to
// such a Session, so there is no input field: a line says why instead. With `agentId` the panel
// shows one Subagent of a Session instead — any Session, a worfy one too — from its own transcript
// file (`<sessionId>/subagents/agent-<agentId>.jsonl`, ticket 15), read-only as well.

export interface ExternalSessionPanelProps {
  projectId: string
  nodeId: string
  sessionId: string
  /** Show this Subagent of the Session instead of the Session. */
  agentId?: string | undefined
  /** The rail's blocks (rail/index.ts); the Session's rail is not drawn for a Subagent. */
  blocks?: readonly RailBlock[]
}

const SUBAGENT_CHIPS: Record<'running' | 'done' | 'error', { status: Status; label: string }> = {
  running: { status: 'working', label: 'running' },
  done: { status: 'done', label: 'done' },
  error: { status: 'blocked', label: 'error' },
}

const styles = {
  readOnly: { fontSize: 'var(--text-13)', color: 'var(--text-secondary)' },
  source: { fontSize: 'var(--text-12)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
} satisfies Record<string, CSSProperties>

export function ExternalSessionPanel({ projectId, nodeId, sessionId, agentId, blocks = [] }: ExternalSessionPanelProps) {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const { live, history } = useClaudeHome(root)
  const transcript = useSessionTranscript(root, sessionId, agentId)
  const tree = useSubagentTree(root, agentId === undefined ? null : sessionId)
  const subagent = agentId === undefined ? undefined : flattenSubagents(tree).find((info) => info.agentId === agentId)
  const saved = useLayout(projectId).state?.layout.nodes.find((node) => node.id === nodeId)
  const data = saved ? readSessionNodeData(saved.data) : null
  const session = live?.find((each) => each.sessionId === sessionId)
  const sessionTitle = session?.name ?? history.find((each) => each.sessionId === sessionId)?.title ?? data?.name ?? `Session ${sessionId.slice(0, 8)}`
  let chip: { status: Status; label: string } = live === undefined ? { status: 'ready', label: '…' } : sessionStatus(session)
  let title = sessionTitle
  // A Subagent's type is shown without the Harness plugin (`worfy:`); the tooltip keeps the full one.
  let titleTooltip = sessionTitle
  const type = subagent?.subagentType ?? null
  if (agentId !== undefined) {
    chip = subagent ? SUBAGENT_CHIPS[subagent.status] : { status: 'ready', label: '…' }
    title = `Subagent ${subagent?.name ?? subagentTypeLabel(type) ?? agentId}`
    titleTooltip = `Subagent ${subagent?.name ?? type ?? agentId}`
  }
  // The live entry says where it runs; once it is gone, the Node's data and the transcript do.
  const desktop = session ? session.entrypoint === 'claude-desktop' : data?.source === 'desktop'
  const cwd = session?.cwd ?? data?.cwd ?? history.find((each) => each.sessionId === sessionId)?.cwd
  const startedIn = desktop ? 'Claude desktop' : 'terminal'

  let empty: string | null = null
  if (transcript.error !== undefined) empty = `The transcript could not be read: ${transcript.error}`
  else if (transcript.loaded && !transcript.found) empty = agentId === undefined ? 'No transcript of this Session yet' : 'No transcript of this Subagent yet'
  const source =
    agentId !== undefined
      ? [subagentTypeLabel(type), subagent?.model, `of ${sessionTitle}`].filter((part) => part !== undefined && part !== null).join(' · ')
      : desktop
        ? 'Claude desktop'
        : `terminal${cwd ? ` · ${cwd}` : ''}`

  return (
    <div className="w-session" data-testid="session-view" data-session-id={sessionId} data-node-id={nodeId} data-agent-id={agentId} data-read-only="true">
      <header className="w-session__header">
        <h1 className="w-session__title" title={titleTooltip}>
          {title}
        </h1>
        <span data-testid="session-state">
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="w-session__divider" aria-hidden="true" />
        <span className="w-mono" style={styles.source} data-testid="session-source" title={agentId !== undefined ? (type ?? undefined) : undefined}>
          {source}
        </span>
        <span className="w-session__spacer" />
      </header>
      <div className="w-session__body">
        <section className="w-session__main" aria-label="Session">
          {empty !== null ? (
            <div className="w-session__empty" data-testid="session-transcript-missing">
              {empty}
            </div>
          ) : (
            <Transcript events={transcript.events} firstIndex={transcript.first} sessionId={null} projectId={projectId} assistantLabel="claude" />
          )}
          <div className="w-composer" data-testid="session-read-only" style={styles.readOnly}>
            {agentId === undefined ? `Read-only: started in ${startedIn}` : 'Read-only: Subagent transcript'}
          </div>
        </section>
        {agentId === undefined ? <SessionRail blocks={blocks} projectId={projectId} nodeId={nodeId} sessionId={null} claudeSessionId={sessionId} /> : null}
      </div>
    </div>
  )
}
