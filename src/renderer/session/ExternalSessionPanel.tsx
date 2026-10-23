import { useEffect, useRef, type CSSProperties } from 'react'
import { subagentTypeLabel } from '../../shared/agent/subagent-type'
import { SHORTCUTS } from '../../shared/shortcuts'
import { flattenSubagents } from '../../shared/transcript/subagents'
import { readSessionNodeData, sessionStatus } from '../claude-home/session-nodes'
import { useOrchestratorView } from '../canvas/nodes/orchestrator-view'
import { useLayout } from '../canvas/useLayout'
import { useSubagentTree } from '../claude-home/subagents'
import { earlierControl, loadEarlierTranscript, transcriptStateNow, useClaudeHome, useSessionTranscript } from '../claude-home/useClaudeHome'
import { useProjects } from '../projects/useProjects'
import { ariaKeys, label, matches } from '../shortcuts/match'
import { StatusChip, type Status } from '../theme/primitives'
import { openSession, subagentParent, subagentSession, useNavigation, type OpenedSession } from './navigation'
import { isRunning, useSessionNodeView } from './node-sessions'
import type { RailBlock } from './rail/index'
import { SessionRail } from './SessionRail'
import { Transcript } from './Transcript'
import { HideToolsButton } from './HideToolsButton'
import { SessionFind } from './SessionFind'
import { useTranscriptFind } from './transcript-find'
import { hideToolsKey, useToolsHidden } from './transcript-view'
import './session.css'

// The Session view of a Session started outside worfy (a terminal, Claude desktop): the same
// transcript as a live Session, its events read from the Session's transcript file under ~/.claude
// and followed as Claude Code appends to it (claude-home/useClaudeHome.ts). worfy cannot write to
// such a Session, so there is no input field: a line says why instead. With `agentId` the panel
// shows one Subagent of a Session instead — any Session, a worfy one too — from its own transcript
// file (`<sessionId>/subagents/agent-<agentId>.jsonl`, ticket 15), read-only as well.
//
// A Subagent's window leads back to its parent (worfy-polish ticket 25): the arrow left of the title
// (and ⌘[, Ctrl+[ elsewhere) goes to the Subagent that started it, or to its Session; the "of
// <Session>" link always goes to the Session. Not to where the window was opened from: opened from
// the Canvas it leads to the parent all the same. The Session opens live when worfy runs it on the
// Node (the Orchestrator, a Session Node), else read-only from its transcript.

export interface ExternalSessionPanelProps {
  projectId: string
  nodeId: string
  sessionId: string
  /** Show this Subagent of the Session instead of the Session. */
  agentId?: string | undefined
  /** The rail's blocks (rail/index.ts); the Session's rail is not drawn for a Subagent. */
  blocks?: readonly RailBlock[]
}

function BackArrow({ to, name }: { to: OpenedSession; name: string }) {
  const view = useNavigation((store) => store.view)
  useEffect(() => {
    // The panel stays mounted under the Canvas: the key belongs to the Session view only while it is shown.
    if (view !== 'session') return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matches(event, SHORTCUTS.back)) return
      event.preventDefault()
      openSession(to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, to])
  const text = `Back to ${name}`
  return (
    <button type="button" className="w-session__button" style={styles.back} aria-label={text} title={`${text} (${label(SHORTCUTS.back)})`} aria-keyshortcuts={ariaKeys(SHORTCUTS.back)} data-testid="session-back" onClick={() => openSession(to)}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 8H3.5M7.5 3.5L3 8l4.5 4.5" />
      </svg>
    </button>
  )
}

const SUBAGENT_CHIPS: Record<'running' | 'done' | 'error', { status: Status; label: string }> = {
  running: { status: 'working', label: 'running' },
  done: { status: 'done', label: 'done' },
  error: { status: 'blocked', label: 'error' },
}

const styles = {
  readOnly: { fontSize: 'var(--text-13)', color: 'var(--text-secondary)' },
  source: { fontSize: 'var(--text-12)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  back: { width: 26, padding: 0, justifyContent: 'center' },
  link: { padding: 0, border: 'none', background: 'none', font: 'inherit', color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer' },
} satisfies Record<string, CSSProperties>

export function ExternalSessionPanel({ projectId, nodeId, sessionId, agentId, blocks = [] }: ExternalSessionPanelProps) {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const { live, history } = useClaudeHome(root)
  const transcript = useSessionTranscript(root, sessionId, agentId)
  // Kept per Session and per Subagent (worfy-ui ticket 25): the same choice as the Session's live view.
  const [hideTools, setHideTools] = useToolsHidden(hideToolsKey({ projectId, nodeId, sessionId, agentId }))
  // ⌘F (worfy-ui ticket 26): over the events read, and in main over the part of the file before them.
  const logRef = useRef<HTMLDivElement>(null)
  const find = useTranscriptFind({
    events: transcript.events,
    firstIndex: transcript.first,
    hideTools,
    log: logRef,
    source:
      root === undefined
        ? undefined
        : { root, sessionId, agentId, earlier: transcript.earlier, opening: transcript.opening, loadEarlier: () => loadEarlierTranscript(root, sessionId, agentId), earlierNow: () => transcriptStateNow(root, sessionId, agentId).earlier },
  })
  const tree = useSubagentTree(root, agentId === undefined ? null : sessionId)
  const subagent = agentId === undefined ? undefined : flattenSubagents(tree).find((info) => info.agentId === agentId)
  const orchestrator = useOrchestratorView(nodeId)
  const nodeSession = useSessionNodeView(projectId, nodeId)
  // worfy runs this Session on the Node now: the way back opens it live.
  const runs =
    (orchestrator !== undefined && orchestrator.state !== 'closed' && orchestrator.sessionId === sessionId) ||
    (isRunning(nodeSession) && (nodeSession.sessionId === sessionId || nodeSession.sdkSessionId === sessionId))
  const parentAgentId = subagent?.parentAgentId ?? null
  const parent = parentAgentId === null ? undefined : flattenSubagents(tree).find((info) => info.agentId === parentAgentId)
  const back = subagentParent({ nodeId, projectId, sessionId }, parentAgentId, runs)
  const toSession = subagentSession({ nodeId, projectId, sessionId }, runs)
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
  const backName = parentAgentId === null ? sessionTitle : `Subagent ${parent?.name ?? subagentTypeLabel(parent?.subagentType ?? null) ?? parentAgentId}`
  const source =
    agentId !== undefined
      ? [subagentTypeLabel(type), subagent?.model].filter((part) => part !== undefined && part !== null).join(' · ')
      : desktop
        ? 'Claude desktop'
        : `terminal${cwd ? ` · ${cwd}` : ''}`

  return (
    <div className="w-session" data-testid="session-view" data-session-id={sessionId} data-node-id={nodeId} data-agent-id={agentId} data-read-only="true">
      <header className="w-session__header" data-toast-keep-out="">
        {agentId !== undefined ? <BackArrow to={back} name={backName} /> : null}
        <h1 className="w-session__title" title={titleTooltip}>
          {title}
        </h1>
        <span data-testid="session-state">
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="w-session__divider" aria-hidden="true" />
        <span className="w-mono" style={styles.source} data-testid="session-source" title={agentId !== undefined ? (type ?? undefined) : undefined}>
          {source}
          {agentId !== undefined ? (
            <>
              {source === '' ? 'of ' : ' · of '}
              <a
                href="#"
                style={styles.link}
                data-testid="session-source-session"
                onClick={(event) => {
                  event.preventDefault()
                  openSession(toSession)
                }}
              >
                {sessionTitle}
              </a>
            </>
          ) : null}
        </span>
        <span className="w-session__spacer" />
        <HideToolsButton hidden={hideTools} onChange={setHideTools} />
      </header>
      <div className="w-session__body">
        <section className="w-session__main" aria-label="Session">
          {empty === null ? <SessionFind find={find} /> : null}
          {empty !== null ? (
            <div className="w-session__empty" data-testid="session-transcript-missing">
              {empty}
            </div>
          ) : (
            <Transcript
              events={transcript.events}
              firstIndex={transcript.first}
              sessionId={null}
              projectId={projectId}
              assistantLabel="claude"
              earlier={earlierControl(transcript, root, sessionId, agentId)}
              hideTools={hideTools}
              find={find.transcript}
              logRef={logRef}
            />
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
