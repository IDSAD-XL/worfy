import { useEffect, useMemo, useState } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { useOrchestratorView } from '../canvas/nodes/orchestrator-view'
import { invoke } from '../ipc'
import { StatusChip } from '../theme/primitives'
import { formatCost, permissionLabel, STATE_CHIPS } from './format'
import { promptHistory } from './history'
import { ExternalSessionPanel } from './ExternalSessionPanel'
import { MessageInput } from './MessageInput'
import { useNavigation } from './navigation'
import { railBlocks, type RailBlock, type RailBlockProps } from './rail/index'
import { ensureAgentEvents, recordPrompt, retractPrompt, useSessionLog } from './store'
import { Transcript } from './Transcript'
import './session.css'

// The Session view (the Session side of the toolbar's Canvas / Session switch): one Session in
// full. A header with its state, model, effort, permission mode and cost, and an Interrupt
// button; the transcript; the input field; and on the right the rail, made of the blocks in
// rail/ (rail/index.ts). It shows the Session a double click on its Node opened (navigation.ts),
// or else the active Project's Orchestrator.

export interface SessionViewProps {
  /** The active Project; undefined while there is none. */
  projectId: string | undefined
  projectName: string | undefined
}

/** The Node of the active Project's Orchestrator, from `orchestrator.open` (main opens it anyway). */
function useOrchestratorNode(projectId: string | undefined): string | null {
  const [found, setFound] = useState<{ projectId: string; nodeId: string } | null>(null)
  useEffect(() => {
    if (projectId === undefined) return
    let current = true
    void invoke('orchestrator.open', { projectId }).then((result) => {
      if (!current) return
      if (result.ok) setFound({ projectId, nodeId: result.value.nodeId })
      else console.error(`orchestrator.open ${projectId} failed:`, result.error)
    })
    return () => {
      current = false
    }
  }, [projectId])
  return found !== null && found.projectId === projectId ? found.nodeId : null
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
  return (
    <button type="button" className="w-session__button" data-testid={testId} disabled={disabled} onClick={onClick}>
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
  const view = useOrchestratorView(nodeId)
  const sessionId = view?.sessionId ?? null
  const log = useSessionLog(sessionId)
  const events = log.events
  const history = useMemo(() => promptHistory(events), [events])
  const facts = useMemo(() => sessionFacts(events), [events])
  const state = view?.state ?? 'starting'
  const chip = STATE_CHIPS[state]
  const busy = state === 'busy'
  const model = facts.model ?? view?.model ?? null

  const send = async (text: string): Promise<string | null> => {
    if (sessionId === null) return 'The Session is not running'
    // Shown at once, before Claude Code answers; taken back if it never reached the Session.
    recordPrompt(sessionId, text)
    const result = await invoke('agent.send', { sessionId, text })
    if (result.ok) return null
    retractPrompt(sessionId, text)
    return result.error
  }

  const interrupt = () => {
    if (sessionId === null) return
    void invoke('agent.interrupt', { sessionId }).then((result) => {
      if (!result.ok) console.error('agent.interrupt failed:', result.error)
    })
  }

  return (
    <div className="w-session" data-testid="session-view" data-session-id={sessionId ?? undefined} data-node-id={nodeId}>
      <header className="w-session__header">
        <span className="w-session__icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="3.5" r="1.75" />
            <circle cx="3.5" cy="12.5" r="1.75" />
            <circle cx="12.5" cy="12.5" r="1.75" />
            <path d="M8 5.25v3M8 8.25L4.5 11M8 8.25l3.5 2.75" />
          </svg>
        </span>
        <h1 className="w-session__title">
          Orchestrator
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
          <span className="w-mono w-session__fact-value" data-testid="session-model">
            {model ?? '—'}
          </span>
        </span>
        <span className="w-session__fact" title="Effort is not reported by Claude Code yet">
          <span className="w-session__fact-label">Effort</span>
          <span className="w-mono w-session__fact-value" data-testid="session-effort">
            —
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
            {view ? formatCost(view.costUsd) : '—'}
          </span>
          <span className="w-session__fact-label">this session</span>
        </span>
        <span className="w-session__spacer" />
        <Interrupt testId="session-interrupt" disabled={!busy} onClick={interrupt} />
      </header>
      <div className="w-session__body">
        <section className="w-session__main" aria-label="Session">
          <Transcript events={events} firstIndex={log.first} sessionId={sessionId} projectId={projectId} assistantLabel="orch" />
          <MessageInput key={nodeId} sessionId={sessionId} busy={busy} history={history} recipient="Orchestrator" onSend={send} onInterrupt={interrupt} />
        </section>
        <SessionRail blocks={blocks} projectId={projectId} nodeId={nodeId} sessionId={sessionId} />
      </div>
    </div>
  )
}

export function SessionView({ projectId, projectName }: SessionViewProps) {
  useEffect(ensureAgentEvents, [])
  const opened = useNavigation((store) => store.opened)
  const orchestrator = useOrchestratorNode(projectId)
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
  if (nodeId === null) {
    return (
      <div className="w-session__empty" data-testid="session-view-empty">
        Starting the Orchestrator…
      </div>
    )
  }
  return <SessionPanel projectId={projectId} projectName={projectName} nodeId={nodeId} blocks={railBlocks} />
}
