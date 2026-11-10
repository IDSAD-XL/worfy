import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import { chatCommandToast } from '../../shared/autopilot/chat-command'
import { ORCHESTRATOR_KIND, readOrchestratorData } from '../../shared/ipc/orchestrator'
import { UNNAMED_VENDOR, vendorLabel } from '../../shared/vendors/vendor'
import { useOrchestratorView } from '../canvas/nodes/orchestrator-view'
import { useLayout } from '../canvas/useLayout'
import { earlierControl, loadEarlierTranscript, loadEarlierUntil, sessionTranscriptNow, useSessionTranscript } from '../claude-home/useClaudeHome'
import { invoke } from '../ipc'
import { writeAction } from '../projects/read-only'
import { useProjects, useReadOnly } from '../projects/useProjects'
import { StatusChip } from '../theme/primitives'
import { showToast } from '../toast/toasts'
import { formatCost, permissionLabel, STATE_CHIPS } from './format'
import { codexDefaultEffort, headerEffort, headerModel, useCodexModels } from './header-facts'
import { promptHistory } from './history'
import { ExternalSessionPanel } from './ExternalSessionPanel'
import { dropRefusal, useChatDrop } from './chat-drop'
import { draftKey } from './drafts'
import { MessageInput, type MessageInputHandle, type OutgoingMessage } from './MessageInput'
import { useOpenedSession } from './navigation'
import { useWaitingRequests } from './open-requests'
import { AcceptedAdvice, ProductSessionPanel, ProductTopicName } from './ProductSessionPanel'
import { chatQueue } from './product-session'
import { SessionPicker } from './SessionPicker'
import { useSessionNodeView } from './node-sessions'
import { railBlocks, type RailBlock, type RailBlockProps } from './rail/index'
import { useShowSession } from './shown-session'
import { ensureAgentEvents, joinPastAndLive, keepsTurnBeforeResume, useSessionControls, useSessionLog } from './store'
import { Transcript } from './Transcript'
import { VendorBadge } from './VendorBadge'
import { HideToolsButton } from './HideToolsButton'
import { SessionFind } from './SessionFind'
import { pastSettled, useTranscriptFind } from './transcript-find'
import { useSessionToolsHidden } from './transcript-view'
import './session.css'

// The Session view (the Session side of the toolbar's Canvas / Session switch): one Session in
// full. A header with its state, the Vendor of a Session Node's agent (VendorBadge.tsx), model,
// effort, permission mode and cost, and an Interrupt button; the transcript; the input field; and on the right the rail, made of the blocks in
// rail/ (rail/index.ts). It shows the Session a double click on its Node opened (navigation.ts),
// or else the active Project's Orchestrator.
//
// A Session that already has a transcript file — resumed on its Node, or the Orchestrator's saved
// Session after a restart of worfy — shows the turns the file holds first, read as the read-only
// view reads them (ExternalSessionPanel.tsx), and its live events after them, no turn twice
// (store.ts, joinPastAndLive; worfy-daily ticket 22).
//
// A Product Session (a Session Node of kind `product`, worfy-product-session ticket 07) is headed
// «Product Session» and has its own body (ProductSessionPanel.tsx): the Mind map, a divider and the
// chat, with an agents strip in place of the rail and no Binding. As in the owner's prototype (ticket 19),
// its header names the topic and has no Model, Effort, Permissions, Cost or Hide tools, its chat has a
// heading of its own and draws the conversation only, and its input field has no pickers, meter or queue.

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
  // A window that opened or reloaded after a request went out asks main for the open ones, so their cards
  // stand in the transcript, a Product Session's chat too (worfy-product-session ticket 30).
  const { unseen } = useWaitingRequests(sessionId, view === undefined ? null : state)
  // A turn waiting for a permission answer still runs: Interrupt refuses the request (ticket 21).
  const busy = state === 'busy' || state === 'needs_permission'
  const { settings, modelPick, queue } = useSessionControls(sessionId)
  // The SDK session id: the live id once it is Claude Code's own — a resumed Session's is a temporary
  // `pending-…` until system/init (src/main/agent/session.ts) — else the one the Session resumes.
  const claudeSessionId = sessionId !== null && !sessionId.startsWith('pending-') ? sessionId : (transcriptId ?? null)
  // A view choice of this screen, kept per Session (worfy-ui ticket 25), not one of the agent's picks above.
  const [hideTools, setHideTools] = useSessionToolsHidden({ projectId, nodeId, liveId: sessionId, sessionId: claudeSessionId })
  // The kind of a Session Node: its view's, else the one its Node saved, so the body does not change once the view arrives.
  const savedKind = savedNode?.data.kind
  const product = orchestrator === undefined && (nodeSession?.kind ?? savedKind) === 'product'
  // ⌘F (worfy-ui ticket 26): the live events and the transcript before them; main searches the part
  // of the file not read yet — only once the window shows a turn from before Resume (pastSettled).
  const logRef = useRef<HTMLDivElement>(null)
  const beforeResume = useMemo(() => keepsTurnBeforeResume(events.slice(0, events.length - live.length)), [events, live])
  const find = useTranscriptFind({
    events,
    firstIndex,
    hideTools,
    product,
    log: logRef,
    source:
      root === undefined || transcriptId === undefined
        ? undefined
        : {
            root,
            sessionId: transcriptId,
            earlier: past.earlier,
            opening: past.opening,
            loadEarlier: () => loadEarlierTranscript(root, transcriptId),
            earlierNow: () => sessionTranscriptNow(root, transcriptId).earlier,
            settled: pastSettled(beforeResume, live.length, past.earlier),
            settle: loadPast,
          },
  })
  // A model picked since the last system/init shows at once, as the picker shows it; the next
  // init names the model it runs (store.ts, modelPick; worfy-week ticket 12). Claude Code's
  // default model is «default» until then: only init says which model it stands for.
  // An empty name reads as unknown («—»), as none does (worfy-polish 52).
  const model = headerModel(modelPick, facts.model, view?.model ?? null)
  const heading = orchestrator !== undefined || nodeSession === undefined ? 'Orchestrator' : product ? 'Product Session' : 'Session'
  // The Vendor whose agent runs a Session Node (worfy-multi-vendor ticket 24): its view's, else the one
  // its Node saved, Claude Code for a Node saved without one; null for the Orchestrator.
  const savedVendor = savedNode?.data.vendor
  const vendor = orchestrator !== undefined || savedNode?.kind === 'orchestrator' ? null : (nodeSession?.vendor ?? (typeof savedVendor === 'string' ? savedVendor : UNNAMED_VENDOR))
  // «orch» is the Orchestrator's alone (worfy-daily ticket 24); any other Session answers by its Vendor's name, «claude» or «codex».
  const assistantLabel = vendor === null ? 'orch' : vendorLabel(vendor, 'agent')
  // A Codex Session with no level picked shows its model's default level (header-facts.ts; worfy-polish 52).
  const runningModel = headerModel(null, facts.model, view?.model ?? null)
  const codexModels = useCodexModels(sessionId, vendor, runningModel)
  const effort = headerEffort(settings?.effort ?? null, vendor, codexDefaultEffort(codexModels, modelPick, runningModel))
  // The transcript shows the message when main gives it to Claude Code (a `prompt` event): at
  // once, or after the running turn when it waits in the queue.
  const send = async ({ text, attachments }: OutgoingMessage): Promise<string | null> => {
    if (sessionId === null) return 'The Session is not running'
    const result = await invoke('agent.send', { sessionId, text, ...(attachments.length > 0 ? { attachments } : {}) })
    if (!result.ok) return result.error
    // An Autopilot command started Autopilot, or was refused, instead of reaching the agent (worfy-flight-recorder ticket 22).
    if (result.value?.autopilot) showToast(chatCommandToast(result.value.autopilot))
    return null
  }

  // A file dropped anywhere on the chat, the transcript too, goes to the input field (worfy-ui ticket 28).
  const input = useRef<MessageInputHandle>(null)
  const readOnly = useReadOnly()
  const drop = useChatDrop(dropRefusal(sessionId, readOnly), (files) => input.current?.drop(files))

  const interrupt = () => {
    if (sessionId === null) return
    void invoke('agent.interrupt', { sessionId }).then((result) => {
      if (!result.ok) console.error('agent.interrupt failed:', result.error)
    })
  }

  // The transcript and the input field: the body of a plain Session, the chat of a Product Session.
  const chat = (
    <section className="w-session__main" aria-label="Session" {...drop.handlers}>
      {drop.overlay}
      {/* The chat's own heading in a Product Session, as in the owner's prototype (worfy-product-session ticket 19, Q5). */}
      {product && nodeSession !== undefined ? (
        <div className="w-product__chat-head" data-testid="product-chat-head">
          {/* One line in any column: a narrow one cuts the words with «…», the Vendor tag stays whole (ticket 24). */}
          <span className="w-product__chat-name" data-testid="product-chat-name">
            <span className="w-product__chat-title">Conversation</span> <span className="w-product__chat-who">with the advisor</span>
          </span>
          {/* A small bordered tag, as the prototype has it (ticket 22). */}
          <span className="w-product__chat-vendor">
            <VendorBadge vendor={nodeSession.vendor} muted testId="product-chat-vendor" />
          </span>
        </div>
      ) : null}
      <SessionFind find={find} />
      {/* Another Session gets a fresh log: no row stays opened from the one shown before (rows are keyed by position). */}
      <Transcript
        key={claudeSessionId ?? `node:${nodeId}`}
        events={events}
        firstIndex={firstIndex}
        sessionId={sessionId}
        projectId={projectId}
        assistantLabel={assistantLabel}
        earlier={earlier}
        hideTools={hideTools}
        find={find.transcript}
        logRef={logRef}
        working={state === 'busy'}
        queued={product ? chatQueue(queue, state) : null}
        narration={product ? (log.narration ?? null) : null}
      />
      {/* Main has no open request either: no card to draw, so the chat says what the Session waits for. */}
      {unseen ? (
        <p className="w-session__unseen" role="alert" data-testid="session-request-unseen">
          The Session waits for an answer this window cannot show. Interrupt refuses the request.
        </p>
      ) : null}
      <MessageInput ref={input} key={nodeId} nodeId={nodeId} draft={draftKey('chat', projectId, nodeId)} sessionId={sessionId} busy={busy} history={history} recipient={heading} product={product} onSend={send} onInterrupt={interrupt} />
    </section>
  )

  return (
    <div className={`w-session${product ? ' w-session--product' : ''}`} data-testid="session-view" data-session-id={sessionId ?? undefined} data-node-id={nodeId} data-transcript-events={past.events.length}>
      <header className="w-session__header" data-toast-keep-out="">
        {/* A Product Session carries the prototype's violet label in place of the icon (worfy-product-session ticket 27). */}
        {product ? (
          <span className="w-session__product-label" title="A Session of the product advisor, not a developer" data-testid="product-session-label">
            Product Session
          </span>
        ) : (
          <span className="w-session__icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="3.5" r="1.75" />
              <circle cx="3.5" cy="12.5" r="1.75" />
              <circle cx="12.5" cy="12.5" r="1.75" />
              <path d="M8 5.25v3M8 8.25L4.5 11M8 8.25l3.5 2.75" />
            </svg>
          </span>
        )}
        <h1 className="w-session__title" title={projectName ? `${heading} · ${projectName}` : heading}>
          {heading}
          {/* A Product Session names the topic its Mind map shows, once there is one (ticket 19, Q3). */}
          {product ? (
            <ProductTopicName projectId={projectId} nodeId={nodeId} fallback={projectName} />
          ) : projectName ? (
            <>
              <span className="w-session__dot"> · </span>
              {projectName}
            </>
          ) : null}
        </h1>
        {/* Once main's view of a Session Node is here: no Vendor flashes in the Orchestrator's header before its view. */}
        {orchestrator === undefined && nodeSession !== undefined ? <VendorBadge vendor={nodeSession.vendor} testId="session-vendor" /> : null}
        <span data-testid="session-state" title={view?.error ?? undefined}>
          <StatusChip status={chip.status} label={chip.label} />
        </span>
        <SessionPicker projectId={projectId} shown={{ nodeId, projectId }} shownTitle={heading} />
        {/* A Product Session's header has no Model, Effort, Permissions, Cost or Hide tools (ticket 19, Q3), and no
            layout switch (owner, 2026-11-09, Q3); its advice share brings its own divider, once there is advice. */}
        {product ? null : (
          <>
            <span className="w-session__divider" aria-hidden="true" />
            {/* The model gives way first when the header is short of room: its value ends in «…», the whole name in the tooltip. */}
            <span className="w-session__fact w-session__fact--model">
              <span className="w-session__fact-label">Model</span>
              <span
                className="w-mono w-session__fact-value"
                data-testid="session-model"
                title={modelPick !== null ? 'Picked for the next turn: its system/init will name the model' : (model ?? undefined)}
              >
                {model ?? '—'}
              </span>
            </span>
            <span className="w-session__fact" title={effort.title}>
              <span className="w-session__fact-label">Effort</span>
              <span
                className={`w-mono w-session__fact-value${effort.isDefault ? ' w-session__fact-value--default' : ''}`}
                data-testid="session-effort"
                data-default={effort.isDefault ? 'true' : undefined}
              >
                {effort.text}
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
          </>
        )}
        {/* The share of the advisor's advice the Product owner accepted (worfy-product-session ticket 14). */}
        {product ? <AcceptedAdvice projectId={projectId} /> : null}
        <span className="w-session__spacer" />
        {product ? null : <HideToolsButton hidden={hideTools} onChange={setHideTools} />}
        <Interrupt testId="session-interrupt" disabled={!busy} onClick={interrupt} />
      </header>
      {product ? (
        <ProductSessionPanel projectId={projectId} nodeId={nodeId} sessionId={sessionId} events={events}>
          {chat}
        </ProductSessionPanel>
      ) : (
        <div className="w-session__body">
          {chat}
          <SessionRail blocks={blocks} projectId={projectId} nodeId={nodeId} sessionId={sessionId} />
        </div>
      )}
    </div>
  )
}

export function SessionView({ projectId, projectName }: SessionViewProps) {
  useEffect(ensureAgentEvents, [])
  if (projectId === undefined) {
    return (
      <div className="w-session__empty" data-testid="session-view-empty">
        No project
      </div>
    )
  }
  return <ProjectSessionView projectId={projectId} projectName={projectName} />
}

/** The Session view of a Project: its last opened Session while that Session's Node is on the Canvas, else its Orchestrator (navigation.ts). */
function ProjectSessionView({ projectId, projectName }: { projectId: string; projectName: string | undefined }) {
  const opened = useOpenedSession(projectId)
  const readOnly = useReadOnly()
  const orchestrator = useOrchestratorNode(projectId, readOnly !== null)
  const nodeId = opened !== null ? opened.nodeId : orchestrator

  if (opened?.external) {
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
