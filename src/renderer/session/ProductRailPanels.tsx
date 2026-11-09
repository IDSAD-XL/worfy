import { useEffect, useState } from 'react'
import type { AgentEvent } from '../../shared/agent/events'
import type { SubagentInfo } from '../../shared/transcript/subagents'
import { TREE_POLL_MS } from '../claude-home/subagents'
import { invoke } from '../ipc'
import { useNow } from '../limits/useLimits'
import { Markdown } from '../markdown/Markdown'
import {
  criticWriteOf,
  fileNameOf,
  isCritic,
  isIdeaGenerator,
  lastAnswerOf,
  latestAgent,
  objectionCount,
  productAgentState,
  productAgentTime,
  type ProductDraft,
} from './product-agents'

// The panels the Critic, Idea generator and Drafts buttons of a Product Session's strip open
// (ProductSessionPanel.tsx; worfy-product-session ticket 27, Q2 of the owner's decisions of 2026-11-09), in
// the column the agents list uses:
//
// - Critic — the review the Session's last critic wrote: the Write of `critic/*.md` in its own transcript
//   (product-agents.ts, criticWriteOf), as the agents list counts its objections. A review the orchestrator's
//   critic wrote into `docs/product/critic/` outside this Session is not here: the renderer reads no file of
//   that folder (`docs.read` serves HANDOFF.md and ADRs only).
// - Idea generator — the last answer of the Session's last `product-ideas` agent, from its own transcript, and
//   its state.
// - Drafts — the advisor's drafts this Session's chat wrote (product-agents.ts, draftsOf).

/** The end of an agent's transcript read for its review or answer: both come at its end. */
const TAIL_BYTES = 2 * 1024 * 1024

/**
 * The events of an agent's own transcript, read when the panel opens and when the agent's state changes, and
 * every TREE_POLL_MS while it runs. Undefined until the first answer; `error` when the read fails. None while
 * the agent's transcript cannot be named yet (no agent id, Project root or Session id): it has written nothing
 * this panel could show.
 */
function useAgentEvents(root: string | undefined, session: string | null, agent: SubagentInfo | undefined): { events: readonly AgentEvent[] | undefined; error: string | undefined } {
  const agentId = agent?.agentId ?? null
  const status = agent?.status
  const [state, setState] = useState<{ agentId: string; events?: readonly AgentEvent[]; error?: string } | null>(null)
  useEffect(() => {
    if (root === undefined || session === null || agentId === null) return
    let live = true
    let failed = false
    const read = () =>
      void invoke('claudeHome.subagentTranscript', { projectRoot: root, sessionId: session, agentId, back: { bytes: TAIL_BYTES } }).then((result) => {
        if (!live) return
        if (result.ok) {
          setState({ agentId, events: result.value.events })
          return
        }
        // Once per opening: a running agent is read again and again.
        if (!failed) console.error(`claudeHome.subagentTranscript ${session}/${agentId} failed:`, result.error)
        failed = true
        setState((was) => (was?.agentId === agentId && was.events !== undefined ? was : { agentId, error: result.error }))
      })
    read()
    const timer = status === 'running' ? setInterval(read, TREE_POLL_MS) : undefined
    return () => {
      live = false
      if (timer !== undefined) clearInterval(timer)
    }
  }, [root, session, agentId, status])
  if (root === undefined || session === null || agentId === null) return { events: agent === undefined ? undefined : [], error: undefined }
  return state !== null && state.agentId === agentId ? { events: state.events, error: state.error } : { events: undefined, error: undefined }
}

function Empty({ testId, children }: { testId: string; children: string }) {
  return (
    <p className="w-product__agents-empty" data-testid={testId}>
      {children}
    </p>
  )
}

/** The name, the task and the state line of the agent a panel shows, as a row of the agents list has them. */
function AgentLine({ agent, objections }: { agent: SubagentInfo; objections?: number | undefined }) {
  const now = useNow()
  return (
    <div className="w-product__rail-agent" data-status={agent.status}>
      {agent.description ? <div className="w-product__agent-about">{agent.description}</div> : null}
      <div className="w-product__agent-state" data-testid="product-rail-state">
        <span className="w-product__agent-dot" data-status={agent.status} aria-hidden="true" /> {productAgentState(agent.status, objections, productAgentTime(agent, now))}
      </div>
    </div>
  )
}

interface AgentPanelProps {
  projectId: string
  agents: readonly SubagentInfo[]
  root: string | undefined
  session: string | null
}

/** The Critic button's panel: the last critic's review, its file and its objections. */
export function CriticPanel({ projectId, agents, root, session }: AgentPanelProps) {
  const critic = latestAgent(agents, isCritic)
  const { events, error } = useAgentEvents(root, session, critic)
  if (critic === undefined) return <Empty testId="product-critic-empty">No critic in this Session yet</Empty>
  const review = events === undefined ? undefined : criticWriteOf(events)
  return (
    <div className="w-product__rail-body" data-testid="product-critic">
      <AgentLine agent={critic} objections={review === undefined ? undefined : objectionCount(review.text)} />
      {review !== undefined ? (
        <>
          <div className="w-product__rail-file w-mono" title={review.path} data-testid="product-critic-file">
            {fileNameOf(review.path)}
          </div>
          <div className="w-product__rail-text" data-testid="product-critic-review">
            <Markdown text={review.text} projectId={projectId} />
          </div>
        </>
      ) : error !== undefined ? (
        <Empty testId="product-critic-error">{`Could not read the critic’s transcript: ${error}`}</Empty>
      ) : events === undefined ? null : (
        <Empty testId="product-critic-no-review">No review written yet</Empty>
      )}
    </div>
  )
}

/** The Idea generator button's panel: the last idea generator's state and last answer. */
export function IdeasPanel({ projectId, agents, root, session }: AgentPanelProps) {
  const generator = latestAgent(agents, isIdeaGenerator)
  const { events, error } = useAgentEvents(root, session, generator)
  if (generator === undefined) return <Empty testId="product-ideas-empty">No idea generator in this Session yet</Empty>
  const answer = events === undefined ? undefined : lastAnswerOf(events)
  return (
    <div className="w-product__rail-body" data-testid="product-ideas">
      <AgentLine agent={generator} />
      {answer !== undefined ? (
        <div className="w-product__rail-text" data-testid="product-ideas-answer">
          <Markdown text={answer} projectId={projectId} breaks />
        </div>
      ) : error !== undefined ? (
        <Empty testId="product-ideas-error">{`Could not read the idea generator’s transcript: ${error}`}</Empty>
      ) : events === undefined ? null : (
        <Empty testId="product-ideas-no-answer">No ideas written yet</Empty>
      )}
    </div>
  )
}

/** The Drafts button's panel: the advisor's drafts this chat wrote, the last written first; a click shows one. */
export function DraftsPanel({ projectId, drafts }: { projectId: string; drafts: readonly ProductDraft[] }) {
  const [shown, setShown] = useState<string | null>(null)
  if (drafts.length === 0) return <Empty testId="product-drafts-empty">No drafts in this chat yet</Empty>
  return (
    <ul className="w-product__agents-list" data-testid="product-drafts-list">
      {drafts.map((draft) => {
        const open = shown === draft.path
        return (
          <li key={draft.path} className="w-product__agent" data-testid="product-draft">
            <button type="button" className="w-product__draft-button" aria-expanded={open} title={draft.path} onClick={() => setShown(open ? null : draft.path)}>
              <span className="w-product__agent-name w-mono">{draft.file}</span>
              <span className="w-product__agent-state">
                {draft.topic} · {draft.writes === 1 ? 'written once' : `written ${draft.writes} times`}
              </span>
            </button>
            {open ? (
              <div className="w-product__rail-text" data-testid="product-draft-text">
                {draft.text === null ? (
                  <Empty testId="product-draft-no-text">Only edits of this draft are in this chat</Empty>
                ) : (
                  <>
                    {draft.editedSince ? <Empty testId="product-draft-edited">Edited after this text was written</Empty> : null}
                    <Markdown text={draft.text} projectId={projectId} />
                  </>
                )}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
