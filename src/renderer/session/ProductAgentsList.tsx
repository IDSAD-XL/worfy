import { useEffect, useState } from 'react'
import type { SubagentInfo } from '../../shared/transcript/subagents'
import { INTERRUPTED_TOOLTIP, TREE_POLL_MS } from '../claude-home/subagents'
import { invoke } from '../ipc'
import { criticReviewOf, isCritic, objectionCount, productAgentName, productAgentState } from './product-agents'

// The list the agents strip of a Product Session opens (ProductSessionPanel.tsx; worfy-product-session
// ticket 20, Q6 of the owner's decisions of 2026-11-08), as the prototype has it: one row per agent of the
// Session with a status dot, the name and the state — «Critic — working · 3 objections» — and what it was
// asked to do under it. The words are in product-agents.ts.

/** The end of a critic's transcript read for its review: the Write of the review comes just before its answer. */
const REVIEW_WINDOW_BYTES = 2 * 1024 * 1024

/** How often the transcript of a running critic is read again while the list is open: the Subagent tree's pace. */
const RUNNING_READ_MS = TREE_POLL_MS

/**
 * The number of objections of each critic in `agents`, by agent id, once its transcript holds the Write of
 * its review. Read when the list opens and when a critic's state changes, and every RUNNING_READ_MS while a
 * critic runs: it writes its review before it answers. The agent id is enough — the live events of the
 * Session name it before the Subagent tree has read the critic's files. A read that fails, or a transcript
 * not written yet, leaves that critic without a number.
 */
function useObjectionCounts(root: string | undefined, session: string | null, agents: readonly SubagentInfo[]): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map())
  const critics = agents.filter((info) => isCritic(info) && info.agentId !== null)
  // The critics and their states, as one value: a new tree with the same critics in the same states reads nothing.
  const key = JSON.stringify(critics.map((info) => [info.agentId, info.status]))
  useEffect(() => {
    const entries = JSON.parse(key) as [string, SubagentInfo['status']][]
    if (root === undefined || session === null || entries.length === 0) return
    let live = true
    const failed = new Set<string>()
    const read = (agentId: string) =>
      void invoke('claudeHome.subagentTranscript', { projectRoot: root, sessionId: session, agentId, back: { bytes: REVIEW_WINDOW_BYTES } }).then((result) => {
        if (!live) return
        if (!result.ok) {
          // Once per opening: a running critic is read again and again.
          if (!failed.has(agentId)) console.error(`claudeHome.subagentTranscript ${session}/${agentId} failed:`, result.error)
          failed.add(agentId)
          return
        }
        const text = criticReviewOf(result.value.events)
        if (text === undefined) return
        const count = objectionCount(text)
        setCounts((was) => (was.get(agentId) === count ? was : new Map(was).set(agentId, count)))
      })
    for (const [agentId] of entries) read(agentId)
    const running = entries.filter(([, status]) => status === 'running').map(([agentId]) => agentId)
    const timer = running.length > 0 ? setInterval(() => running.forEach(read), RUNNING_READ_MS) : undefined
    return () => {
      live = false
      if (timer !== undefined) clearInterval(timer)
    }
  }, [root, session, key])
  return counts
}

export function ProductAgentsList({ agents, root, session }: { agents: readonly SubagentInfo[]; root: string | undefined; session: string | null }) {
  const counts = useObjectionCounts(root, session, agents)
  if (agents.length === 0) {
    return (
      <p className="w-product__agents-empty" data-testid="product-agents-empty">
        No agents yet
      </p>
    )
  }
  return (
    <ul className="w-product__agents-list" data-testid="product-agents-list">
      {agents.map((info) => {
        const objections = isCritic(info) && info.agentId !== null ? counts.get(info.agentId) : undefined
        return (
          <li
            key={info.id}
            className="w-product__agent"
            style={info.depth > 1 ? { paddingLeft: `calc(var(--space-3) + ${(info.depth - 1) * 14}px)` } : undefined}
            title={info.status === 'interrupted' ? INTERRUPTED_TOOLTIP : undefined}
            data-status={info.status}
            data-testid="product-agent"
          >
            <div className="w-product__agent-line" data-testid="product-agent-line">
              <span className="w-product__agent-dot" data-status={info.status} aria-hidden="true" />
              <span className="w-product__agent-name">{productAgentName(info)}</span>
              <span className="w-product__agent-state">{` — ${productAgentState(info.status, objections)}`}</span>
            </div>
            {info.description ? <div className="w-product__agent-about">{info.description}</div> : null}
          </li>
        )
      })}
    </ul>
  )
}
