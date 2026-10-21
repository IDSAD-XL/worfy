import { useEffect, useMemo, useState } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { ORCHESTRATOR_KIND, readOrchestratorData } from '../../shared/ipc/orchestrator'
import { useOrchestratorView } from '../canvas/nodes/orchestrator-view'
import { useLayout } from '../canvas/useLayout'
import { earlierControl, loadEarlierUntil, sessionTranscriptNow, useSessionTranscript } from '../claude-home/useClaudeHome'
import { invoke } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useProjects, useReadOnly } from '../projects/useProjects'
import { StatusChip } from '../theme/primitives'
import { formatCost, permissionLabel, STATE_CHIPS } from './format'
import { promptHistory } from './history'
import { ExternalSessionPanel } from './ExternalSessionPanel'
import { MessageInput, type OutgoingMessage } from './MessageInput'
import { useNavigation } from './navigation'
import { useSessionNodeView } from './node-sessions'
import { railBlocks, type RailBlock, type RailBlockProps } from './rail/index'
import { useShowSession } from './shown-session'
import { ensureAgentEvents, joinPastAndLive, useSessionControls, useSessionLog } from './store'
import { Transcript } from './Transcript'
import './session.css'

// The Session view (the Session side of the toolbar's Canvas / Session switch): one Session in
// full. A header with its state, model, effort, permission mode and cost, and an Interrupt
// button; the transcript; the input field; and on the right the rail, made of the blocks in
// rail/ (rail/index.ts). It shows the Session a double click on its Node opened (navigation.ts),
// or else the active Project's Orchestrator.
//
// A Session that already has a transcript file — resumed on its Node, or the Orchestrator's saved
// Session after a restart of worfy — shows the turns the file holds first, read as the read-only
// view reads them (ExternalSessionPanel.tsx), and its live events after them, no turn twice
// (store.ts, joinPastAndLive; worfy-daily ticket 22).

export interface SessionViewProps {
  /** The active Project; undefined while there is none. */
  projectId: string | undefined
  projectName: string | undefined
}

/**
 * The Node of the active Project's Orchestrator, from `orchestrator.open` (main opens it anyway).
 * Not on a read-only screen (worfy-link ticket 25): opening it there is a write; ReadOnlyOrchestrator
 * finds its Node in the Layout instead.
 */
function useOrchestratorNode(projectId: string | undefined, readOnly: boolean): string | null {
  const [found, setFound] = useState<{ projectId: string; nodeId: string } | null>(null)
  useEffect(() => {
    if (projectId === undefined || readOnly) return
    let current = true
    void invoke('orchestrator.open', { projectId }).then((result) => {
      if (!current) return
      if (result.ok) setFound({ projectId, nodeId: result.value.nodeId })
      else console.error(`orchestrator.open ${projectId} failed:`, result.error)
    })
    return () => {
      current = false
    }
  }, [projectId, readOnly])
  return found !== null && found.projectId === projectId ? found.nodeId : null
}

/**
 * The Orchestrator of a Project on a read-only screen (worfy-link ticket 25): its Node as the Layout
 * has it, shown as it runs there; nothing is started. Without one, the empty view says why.
 */
function ReadOnlyOrchestrator({ projectId, projectName, hint }: { projectId: string; projectName: string | undefined; hint: string }) {
  const { state } = useLayout(projectId)
  const node = state?.layout.nodes.find((each) => each.kind === ORCHESTRATOR_KIND)
  if (node === undefined) {
    return (
      <div className="w-session__empty" data-testid="session-view-empty">
        {state === undefined ? 'Loading…' : `No Orchestrator yet. ${hint}`}
      </div>
    )
  }
  return <SessionPanel projectId={projectId} projectName={projectName} nodeId={node.id} blocks={railBlocks} />
}

/** The Session's model and permission mode as its last system/init and system/status said. */
function sessionFacts(events: readonly AgentEvent[]): { model: string | null; permissionMode: string | null } {
  let model: string | null = null
  let permissionMode: string | null = null
  for (const event of events) {
    if (event.type === 'init') {
      model = event.model
      permissionMode = event.permissionMode
    } else if (event.type === 'status' && event.permissionMode !== null) {
      permissionMode = event.permissionMode
    }
  }
  return { model, permissionMode }
}

function SessionRail({ blocks, ...props }: RailBlockProps & { blocks: readonly RailBlock[] }) {
  if (blocks.length === 0) return null
  return (
    <aside className="w-session__rail" aria-label="Session details" data-testid="session-rail">
      {blocks.map(({ id, Component }) => (
        <section key={id} className="w-session__rail-block" data-block={id}>
          <Component {...props} />
        </section>
      ))}
    </aside>
  )
}

interface SessionPanelProps {
  projectId: string
  projectName: string | undefined
  nodeId: string
  blocks: readonly RailBlock[]
}

function Interrupt({ onClick, disabled, testId }: { onClick: () => void; disabled: boolean; testId: string }) {
  // On a read-only screen (worfy-link ticket 25) it is inactive, saying why.
  const readOnly = useReadOnly()
  return (
    <button type="button" className="w-session__button" data-testid={testId} disabled={disabled} {...writeAction(readOnly, onClick)}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
      </svg>
      Interrupt
      <kbd className="w-session__kbd w-mono">esc</kbd>
    </button>
  )
}

/** One Session in full; exported for tests, which pass their own rail blocks. */
export function SessionPanel({ projectId, projectName, nodeId, blocks }: SessionPanelProps) {
  // The Orchestrator's view, or that of a Session worfy runs on a Session Node (ticket 18).
  const orchestrator = useOrchestratorView(nodeId)
  const nodeSession = useSessionNodeView(projectId, nodeId)
  const view = orchestrator ?? nodeSession
  const sessionId = view?.sessionId ?? null
  useShowSession(sessionId)
  const log = useSessionLog(sessionId)
  const live = log.events
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const savedNode = useLayout(projectId).state?.layout.nodes.find((node) => node.id === nodeId)
  // The SDK session whose transcript holds the turns before the live events: the one a Session
  // Node resumed, or the one the Orchestrator's Node saved.
  const transcriptId = (orchestrator !== undefined ? (savedNode ? readOrchestratorData(savedNode.data).sessionId : null) : nodeSession?.sdkSessionId) ?? undefined
  // The transcript opens on its last window; «Load earlier» puts older windows in front (ticket 21).
  const past = useSessionTranscript(root, transcriptId)
  const events = useMemo(() => joinPastAndLive(past.events, live), [past.events, live])
  // A window of only the turns since Resume adds no row (the live events show them): read on. The
  // control reads as loading until the last window, so the transcript keeps its row in place.
  const [readingPast, setReadingPast] = useState(false)
  const loadPast = () => {
    if (root === undefined || transcriptId === undefined) return
    const shownPast = () => joinPastAndLive(sessionTranscriptNow(root, transcriptId).events, live).length - live.length
    const start = shownPast()
    setReadingPast(true)
    void loadEarlierUntil(root, transcriptId, () => shownPast() > start).finally(() => setReadingPast(false))
  }
  const pastControl = earlierControl(past, root, transcriptId, undefined, loadPast)
  const earlier = pastControl && { ...pastControl, loading: pastControl.loading || readingPast }
  // Rows are keyed by position (store.ts, SessionLog.first): counted back from the live events, so
  // a live event keeps its row as the turns before it grow or shrink.
  const firstIndex = log.first - (events.length - live.length)
  const history = useMemo(() => promptHistory(live), [live])
  const facts = useMemo(() => sessionFacts(live), [live])
  const state = view?.state ?? 'starting'
  const chip = STATE_CHIPS[state]
  // A turn waiting for a permission answer still runs: Interrupt refuses the request (ticket 21).
  const busy = state === 'busy' || state === 'needs_permission'
  const { settings, modelPick } = useSessionControls(sessionId)
  // A model picked since the last system/init shows at once, as the picker shows it; the next
  // init names the model it runs (store.ts, modelPick; worfy-week ticket 12). Claude Code's
  // default model is «default» until then: only init says which model it stands for.
  const model = modelPick !== null ? (modelPick.model ?? 'default') : (facts.model ?? view?.model ?? null)
  const heading = orchestrator !== undefined || nodeSession === undefined ? 'Orchestrator' : 'Session'
  // «orch» is the Orchestrator's alone; any other Session answers as «claude», as a read-only one does (worfy-daily ticket 24).
  const assistantLabel = orchestrator !== undefined || savedNode?.kind === 'orchestrator' ? 'orch' : 'claude'
  // The transcript shows the message when main gives it to Claude Code (a `prompt` event): at
  // once, or after the running turn when it waits in the queue.
  const send = async ({ text, attachments }: OutgoingMessage): Promise<string | null> => {
    if (sessionId === null) return 'The Session is not running'
    const result = await invoke('agent.send', { sessionId, text, ...(attachments.length > 0 ? { attachments } : {}) })
    return result.ok ? null : result.error
  }

  const interrupt = () => {
    if (sessionId === null) return
    void invoke('agent.interrupt', { sessionId }).then((result) => {
      if (!result.ok) console.error('agent.interrupt failed:', result.error)
    })
  }

  return (
    <div className="w-session" data-testid="session-view" data-session-id={sessionId ?? undefined} data-node-id={nodeId} data-transcript-events={past.events.length}>
      <header className="w-session__header" data-toast-keep-out="">
        <span className="w-session__icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="3.5" r="1.75" />
            <circle cx="3.5" cy="12.5" r="1.75" />
            <circle cx="12.5" cy="12.5" r="1.75" />
            <path d="M8 5.25v3M8 8.25L4.5 11M8 8.25l3.5 2.75" />
          </svg>
        </span>
        <h1 className="w-session__title">
          {heading}
          {projectName ? (
            <>
              <span className="w-session__dot"> · </span>
              {projectName}
            </>
          ) : null}
        </h1>
        <span data-testid="session-state" title={view?.error ?? undefined}>
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <span className="w-session__divider" aria-hidden="true" />
        <span className="w-session__fact">
          <span className="w-session__fact-label">Model</span>
          <span
            className="w-mono w-session__fact-value"
            data-testid="session-model"
            title={modelPick !== null ? 'Picked for the next turn: its system/init will name the model' : undefined}
          >
            {model ?? '—'}
          </span>
        </span>
        <span className="w-session__fact" title="The level worfy asked for: Claude Code does not report the level it applies">
          <span className="w-session__fact-label">Effort</span>
          <span className="w-mono w-session__fact-value" data-testid="session-effort">
            {settings?.effort ?? '—'}
          </span>
        </span>
        <span className="w-session__fact">
          <span className="w-session__fact-label">Permissions</span>
          {facts.permissionMode !== null ? (
            <span
              className={`w-session__mode w-mono${facts.permissionMode === 'bypassPermissions' ? ' w-session__mode--bypass' : ''}`}
              data-testid="session-permissions"
            >
              {permissionLabel(facts.permissionMode)}
            </span>
          ) : (
            <span className="w-mono w-session__fact-value" data-testid="session-permissions">
              —
            </span>
          )}
        </span>
        <span className="w-session__fact">
          <span className="w-session__fact-label">Cost</span>
          <span className="w-mono w-session__cost" data-testid="session-cost">
            {orchestrator ? formatCost(orchestrator.costUsd) : '—'}
          </span>
          <span className="w-session__fact-label">this session</span>
        </span>
        <span className="w-session__spacer" />
        <Interrupt testId="session-interrupt" disabled={!busy} onClick={interrupt} />
      </header>
      <div className="w-session__body">
        <section className="w-session__main" aria-label="Session">
          <Transcript events={events} firstIndex={firstIndex} sessionId={sessionId} projectId={projectId} assistantLabel={assistantLabel} earlier={earlier} />
          <MessageInput key={nodeId} sessionId={sessionId} busy={busy} history={history} recipient={heading} onSend={send} onInterrupt={interrupt} />
        </section>
        <SessionRail blocks={blocks} projectId={projectId} nodeId={nodeId} sessionId={sessionId} />
      </div>
    </div>
  )
}

export function SessionView({ projectId, projectName }: SessionViewProps) {
  useEffect(ensureAgentEvents, [])
  const opened = useNavigation((store) => store.opened)
  const readOnly = useReadOnly()
  const orchestrator = useOrchestratorNode(projectId, readOnly !== null)
  const nodeId = opened !== null && opened.projectId === projectId ? opened.nodeId : orchestrator

  if (projectId === undefined) {
    return (
      <div className="w-session__empty" data-testid="session-view-empty">
        No project
      </div>
    )
  }
  if (opened?.external && opened.projectId === projectId) {
    const { sessionId, agentId } = opened.external
    return <ExternalSessionPanel key={`${opened.nodeId}/${agentId ?? ''}`} projectId={projectId} nodeId={opened.nodeId} sessionId={sessionId} agentId={agentId} blocks={railBlocks} />
  }
  if (nodeId === null && readOnly !== null) return <ReadOnlyOrchestrator projectId={projectId} projectName={projectName} hint={readOnly} />
  if (nodeId === null) {
    return (
      <div className="w-session__empty" data-testid="session-view-empty">
        Starting the Orchestrator…
      </div>
    )
  }
  return <SessionPanel projectId={projectId} projectName={projectName} nodeId={nodeId} blocks={railBlocks} />
}
