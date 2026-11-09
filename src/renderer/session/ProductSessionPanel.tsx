import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { PRODUCT_SESSION_SPLIT_DEFAULT, PRODUCT_SESSION_SPLIT_MIN, productSessionSplitOf } from '../../shared/settings/app-settings'
import { adviceTotals, type AdviceShare } from '../../shared/product/share'
import { flattenSubagents, type SubagentInfo } from '../../shared/transcript/subagents'
import { hiddenIdsOf, useHiddenSubagents, useSubagentTree, withoutHidden } from '../claude-home/subagents'
import { invoke, showSubscribeError, subscribe } from '../ipc'
import { MindMap } from '../product/MindMap'
import { useMindMap } from '../product/useMindMap'
import { useProjects } from '../projects/useProjects'
import { setAppSettings, useAppSettings } from '../settings/useAppSettings'
import { ProductAgentsList } from './ProductAgentsList'
import { productAgentOrder } from './product-agents'
import { ProductSessionContext } from './product-session'
import type { RailBlockProps } from './rail/index'
import { SplitDivider } from './SplitDivider'

// The body of a Product Session's view (worfy-product-session ticket 07), in place of the plain
// Session's body: the Mind map on the left, a divider, the chat — the same transcript and input field
// as any Session — and at the right edge the agents strip.
//
// The divider starts at 60 / 40 and goes where the person drags it; the share is one per Machine, in
// the app settings (`productSession.split`), written when a drag ends, so every window and the next
// start of worfy show the same split. A double click puts it back to 60 / 40.
//
// The agents strip stands for the rail of a plain Session: a column of icons with the number of the
// Session's Subagents; a click widens the column to 300 px, the chat narrowing, with the list of those
// agents by name and state (tickets 20 and 22, ProductAgentsList.tsx) — «Critic», what it was asked, «working
// · 1 min · 3 objections» — not the rail blocks of a plain Session. A Product Session is bound to no Ticket
// and no Epic.
//
// The left pane draws the Mind map (../product/MindMap.tsx, ticket 08) of the topic the advisor works on.
// A Product Session is bound to no topic in its data, so the pane follows the topic of the Project whose
// files changed last while it is open — the advisor's `mind_map_*` writes are such changes — and keeps
// that name per Node in this window's localStorage, to show the same topic when the Session is opened
// again. Until a topic is known, or while its folder is gone, the pane holds the empty state; when
// `product.topic` fails, it says why.
//
// ProductTopicName is the topic in the Session's header (SessionView.tsx; ticket 19).
//
// AcceptedAdvice is the share of accepted advice in the Session's header (SessionView.tsx; ticket 14):
// main counts it from the Project's Product Session folder on `product.share` (src/shared/product/share.ts)
// and the header asks again on every `product.changed` of the Project, so a `mind_map_decide` shows at
// once. It counts the owner's decisions and does not grade the advice (owner, 2026-11-08); its tooltip says so.

export interface ProductSessionPanelProps extends RailBlockProps {
  /** The chat: the transcript and the input field, as the plain body has them. */
  children: ReactNode
}

/**
 * The Session's Subagents as the Subagents block of a plain Session lists them: every one in its tree, the
 * nested ones too, the hidden ones left out; and the Project's root their transcripts are read under.
 */
function useSessionAgents(projectId: string, session: string | null): { agents: readonly SubagentInfo[]; root: string | undefined } {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const tree = useSubagentTree(root, session)
  const hidden = useHiddenSubagents(projectId)
  // The working agents first, the later started higher (product-agents.ts, productAgentOrder).
  const agents = useMemo(() => flattenSubagents(productAgentOrder(withoutHidden(tree, hiddenIdsOf(hidden, session)))), [tree, hidden, session])
  return { agents, root }
}

const TOPIC_PREFIX = 'worfy.productSession.topic:'

function readTopicName(key: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(TOPIC_PREFIX + key) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * The topic the Node's Mind map shows: the last one of the Project reported by `product.changed` while
 * the pane is open, else the one it showed before.
 */
function useShownTopic(projectId: string, nodeId: string): string | undefined {
  const key = `${projectId}:${nodeId}`
  const [followed, setFollowed] = useState<{ key: string; name: string } | null>(null)
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = subscribe('product.changed', (change) => {
        if (change.projectId !== projectId || change.topic === null) return
        setFollowed((was) => (was?.key === key && was.name === change.name ? was : { key, name: change.name }))
        try {
          globalThis.localStorage.setItem(TOPIC_PREFIX + key, change.name)
        } catch (error) {
          console.error('[product-session] could not keep the topic of the Mind map', error)
        }
      })
    } catch (error) {
      showSubscribeError('product.changed', error)
    }
    return () => unsubscribe?.()
  }, [projectId, key])
  return followed?.key === key ? followed.name : readTopicName(key)
}

/**
 * The topic of the Node's Mind map in the header of a Product Session (ticket 19, Q3): « · » and its title,
 * else its folder name while the topic is read; `fallback` (the Project's name) until a topic is known.
 * It reads the same shared copy of the topic as the Mind map pane (useMindMap).
 */
export function ProductTopicName({ projectId, nodeId, fallback }: { projectId: string; nodeId: string; fallback: string | undefined }) {
  const name = useShownTopic(projectId, nodeId)
  const { topic } = useMindMap(projectId, name)
  const shown = topic?.title || name || fallback
  if (!shown) return null
  return (
    <>
      <span className="w-session__dot"> · </span>
      <span data-testid="product-session-topic">{shown}</span>
    </>
  )
}

/**
 * The share of accepted advice of the Project, asked on mount and again on every `product.changed` of it;
 * only the answer to the last question is kept, so an older count never replaces a newer one.
 */
function useAdviceShare(projectId: string): { share: AdviceShare | undefined; error: string | undefined } {
  const [state, setState] = useState<{ projectId: string; share?: AdviceShare; error?: string } | null>(null)
  useEffect(() => {
    let asked = 0
    let live = true
    const ask = () => {
      const question = ++asked
      void invoke('product.share', { projectId }).then((result) => {
        if (!live || question !== asked) return
        if (result.ok) setState({ projectId, share: result.value })
        else {
          console.error(`product.share ${projectId} failed:`, result.error)
          setState({ projectId, error: result.error })
        }
      })
    }
    // shortcut: a change of a critic's review alone sends no `product.changed` (the watcher follows topics
    // only, src/main/docs/watch.ts), so it shows with the next topic change or the next open; redo when the
    // watcher reports critic/ too.
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = subscribe('product.changed', (change) => {
        if (change.projectId === projectId) ask()
      })
    } catch (error) {
      showSubscribeError('product.changed', error)
    }
    ask()
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [projectId])
  return state?.projectId === projectId ? { share: state.share, error: state.error } : { share: undefined, error: undefined }
}

const NOT_A_GRADE = 'A count of the owner’s decisions on the advisor’s advice and the critic’s objections, not a measure of how good the advice is.'

/** The tooltip: what the share is of, what waits for a decision and where, and the files left out. */
function adviceTitle(share: AdviceShare): string {
  const totals = adviceTotals(share)
  const lines = [
    `Decided by the owner: ${totals.accepted} accepted, ${totals.rejected} rejected.`,
    `Waiting for a decision: ${totals.pending} (${share.mindMap.pending} in the Mind map, ${share.critic.pending} in the critic’s reviews).`,
  ]
  if (share.skipped.length > 0) lines.push(`Not counted: ${share.skipped.map(({ file, message }) => `${file} (${message})`).join(', ')}.`)
  // The documents' watcher follows topics only (src/main/docs/watch.ts): see the shortcut in useAdviceShare.
  lines.push('A decision written in a critic’s review shows after the next change of a topic.')
  lines.push(NOT_A_GRADE)
  return lines.join('\n')
}

/** The share of accepted advice of the Project, for the header of a Product Session. */
export function AcceptedAdvice({ projectId }: { projectId: string }) {
  const { share, error } = useAdviceShare(projectId)
  const totals = share === undefined ? undefined : adviceTotals(share)
  if (totals !== undefined && share !== undefined && totals.decided === 0) {
    return (
      <span className="w-session__fact w-session__accepted" data-testid="product-session-accepted" title={adviceTitle(share)}>
        <span className="w-session__fact-value">No advice decided yet</span>
      </span>
    )
  }
  const value = totals === undefined ? '—' : `${totals.accepted} of ${totals.decided} · ${Math.round((totals.accepted / totals.decided) * 100)}%`
  const title = error !== undefined ? `Could not count the advice: ${error}` : share === undefined ? undefined : adviceTitle(share)
  return (
    <span className="w-session__fact w-session__accepted" data-testid="product-session-accepted" title={title}>
      <span className="w-session__fact-label">Advice accepted</span>{' '}
      <span className="w-mono w-session__fact-value">{value}</span>
    </span>
  )
}

/** The share of the Mind map: the one being dragged, else the one in the app settings. */
function useSplit(): { share: number; move: (share: number) => void; commit: (share: number) => void } {
  const saved = useAppSettings(productSessionSplitOf)
  const [moving, setMoving] = useState<number | null>(null)
  // Only the answer to the last write lets go of the dragged share: an earlier one must not show an older split.
  const writes = useRef(0)
  const commit = (share: number) => {
    setMoving(share)
    const write = ++writes.current
    void setAppSettings({ productSession: { split: share } }).then((problem) => {
      if (problem !== undefined) console.error('appSettings.set failed:', problem)
      if (write === writes.current) setMoving(null)
    })
  }
  return { share: moving ?? saved, move: setMoving, commit }
}

function AgentsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="3" />
      <circle cx="14" cy="8.5" r="2.4" />
      <path d="M1.8 17c.6-3 2.6-4.6 5.2-4.6s4.6 1.6 5.2 4.6M12.5 12.6c2.6-.4 4.8.9 5.5 3.9" />
    </svg>
  )
}

/** The strip at the right edge; its list widens the column to its right and the chat narrows (ticket 22). */
function AgentsStrip({ agents, root, session }: { agents: readonly SubagentInfo[]; root: string | undefined; session: string | null }) {
  const count = agents.length
  const [open, setOpen] = useState(false)
  const listId = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    toggle.current?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    close()
  }
  return (
    <aside className="w-product__agents" aria-label="Agents" data-testid="product-agents" data-open={open || undefined}>
      <div className="w-product__agents-strip">
        <button
          ref={toggle}
          type="button"
          className="w-product__agents-button"
          aria-expanded={open}
          aria-controls={listId}
          title={`Agents (${count})`}
          data-testid="product-agents-toggle"
          onClick={() => setOpen((was) => !was)}
        >
          <AgentsIcon />
          <span className="w-product__agents-count w-mono" data-testid="product-agents-count">
            {count}
          </span>
        </button>
      </div>
      {open ? (
        <div id={listId} className="w-product__agents-panel" role="region" aria-label="Agents" data-testid="product-agents-panel" onKeyDown={onKeyDown}>
          <div className="w-product__agents-head">
            Agents <span className="w-product__agents-head-count w-mono">{count}</span>
            <button type="button" className="w-product__agents-close" title="Collapse" aria-label="Collapse the agents list" data-testid="product-agents-close" onClick={close}>
              ›
            </button>
          </div>
          <ProductAgentsList agents={agents} root={root} session={session} />
        </div>
      ) : null}
    </aside>
  )
}

export function ProductSessionPanel({ children, ...rail }: ProductSessionPanelProps) {
  const { share, move, commit } = useSplit()
  const session = rail.claudeSessionId ?? rail.sessionId
  const { agents, root } = useSessionAgents(rail.projectId, session)
  const { topic, error } = useMindMap(rail.projectId, useShownTopic(rail.projectId, rail.nodeId))
  return (
    <div className="w-product" data-testid="product-session-panel">
      <div className="w-product__split">
        <section className="w-product__map" aria-label="Mind map" data-testid="product-session-map" style={{ flexBasis: `${Math.round(share * 1000) / 10}%` }}>
          {error !== undefined ? (
            <p className="w-product__map-empty" role="alert" data-testid="product-session-map-error">
              {`Could not read the Mind map: ${error}`}
            </p>
          ) : topic === undefined || topic === null ? (
            <p className="w-product__map-empty" data-testid="product-session-map-empty">
              The Mind map appears once the advisor adds its first node
            </p>
          ) : (
            <MindMap projectId={rail.projectId} topic={topic} />
          )}
        </section>
        <SplitDivider
          share={share}
          min={PRODUCT_SESSION_SPLIT_MIN}
          reset={PRODUCT_SESSION_SPLIT_DEFAULT}
          onMove={move}
          onCommit={commit}
          label="Resize the Mind map and the chat"
          title="Drag to resize. Double-click: 60 / 40"
          testId="product-session-divider"
        />
        <ProductSessionContext value={true}>{children}</ProductSessionContext>
      </div>
      <AgentsStrip agents={agents} root={root} session={session} />
    </div>
  )
}
