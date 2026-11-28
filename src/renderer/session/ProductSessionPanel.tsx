import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import type { AgentEvent } from '../../shared/agent/events'
import type { ProductTopicState } from '../../shared/ipc/product'
import { PRODUCT_SESSION_SPLIT_DEFAULT, PRODUCT_SESSION_SPLIT_MIN, productSessionSplitOf } from '../../shared/settings/app-settings'
import { adviceTotals, type AdviceShare } from '../../shared/product/share'
import { flattenSubagents, type SubagentInfo } from '../../shared/transcript/subagents'
import { hiddenIdsOf, useHiddenSubagents, useSubagentTree, withoutHidden } from '../claude-home/subagents'
import { invoke, showSubscribeError, subscribe } from '../ipc'
import { MindMap } from '../product/MindMap'
import { pickNode, sessionTopicCall, useMindMapFocus, type NodeRef, type SessionTopicCall } from '../product/node-chips'
import { useMindMap } from '../product/useMindMap'
import { useProjects } from '../projects/useProjects'
import { setAppSettings, useAppSettings } from '../settings/useAppSettings'
import { showToast } from '../toast/toasts'
import { ProductAgentsList } from './ProductAgentsList'
import { draftsOf, productAgentOrder, type ProductDraft } from './product-agents'
import { foldTranscript } from './fold'
import { CriticPanel, DraftsPanel, IdeasPanel } from './ProductRailPanels'
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
// · 1 min · 3 objections» — not the rail blocks of a plain Session. Beside it, as the prototype has them (ticket
// 27): Critic, Idea generator and Drafts, each opening its own panel in the same column (ProductRailPanels.tsx).
// A Product Session is bound to no Ticket and no Epic.
//
// The left pane draws the Mind map (../product/MindMap.tsx, ticket 08) of the topic the advisor works on.
// A Product Session is bound to no topic in its data, so the pane shows the topic of the Session's own last
// `mind_map_*` call that names one, read from its events (the loaded transcript and the live ones; in a window
// on a Linked machine the transcript is read from that Machine), so every window of either Machine shows the
// same one (worfy-polish ticket 173). A change of the Project's topics by another Session does not switch it.
// A chip of another topic switches it until the Session's next such call. The name is kept per Node in this
// window's localStorage only for when the loaded part of the transcript holds no such call. Until a topic is
// known, or while its folder is gone, the pane holds the empty state; when `product.topic` fails, it says why.
//
// ProductTopicName is the topic in the Session's header (SessionView.tsx; ticket 19).
//
// AcceptedAdvice is the share of accepted advice in the Session's header (SessionView.tsx; ticket 14):
// main counts it from the Project's Product Session folder on `product.share` (src/shared/product/share.ts)
// and the header asks again on every `product.changed` of the Project, so a `mind_map_decide` shows at
// once. It counts the owner's decisions and does not grade the advice (owner, 2026-11-08); its tooltip says so.
// It shows only once there is advice, decided or not (owner, 2026-11-09, Q3), or when the count fails.

export interface ProductSessionPanelProps extends RailBlockProps {
  /** The chat: the transcript and the input field, as the plain body has them. */
  children: ReactNode
  /** The chat's events, the loaded transcript and the live ones: the Drafts panel lists the drafts they wrote. */
  events?: readonly AgentEvent[] | undefined
  /** The Session's turn is running: the Idea generator panel tells a run of the skill in it as working. */
  busy?: boolean | undefined
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

/** Keeps `name` as the topic the Node's Mind map showed last, for when its loaded transcript names none. */
function keepTopicName(key: string, name: string): void {
  try {
    if (globalThis.localStorage.getItem(TOPIC_PREFIX + key) !== name) globalThis.localStorage.setItem(TOPIC_PREFIX + key, name)
  } catch (error) {
    console.error('[product-session] could not keep the topic of the Mind map', error)
  }
}

/**
 * The topic a chip of another topic switched each Node's Mind map to (useTopicOfChip), by `<projectId>:<nodeId>`,
 * with the id of the Session's last topic call at that moment (`since`) and the last of its events then (`anchor`):
 * the choice holds until the Session calls again.
 */
interface ChosenTopic {
  name: string
  since: string | null
  anchor: AgentEvent | null
}

const useChosenTopics = create<Readonly<Record<string, ChosenTopic>>>(() => ({}))

/** Switches the Node's Mind map to `name` until the Session's next call that names a topic. */
function chooseTopic(key: string, chosen: ChosenTopic): void {
  const was = useChosenTopics.getState()[key]
  if (was?.name !== chosen.name || was.since !== chosen.since || was.anchor !== chosen.anchor) useChosenTopics.setState({ [key]: chosen })
  keepTopicName(key, chosen.name)
}

/**
 * Whether a chip's choice still holds: the Session's last topic call (`last`) is the one it was made after, or one
 * that was in its events already then. «Load earlier» puts older events in front, so an older call found there after
 * the choice comes before its `anchor`; a call the Session made since comes after it. With the anchor gone from the
 * events (they were read anew), any other call ends the choice.
 */
function chipHolds(chosen: ChosenTopic, events: readonly AgentEvent[], last: string | null): boolean {
  if (chosen.since === last || last === null) return true
  if (chosen.anchor === null) return false
  const anchorAt = events.lastIndexOf(chosen.anchor)
  if (anchorAt < 0) return false
  const callAt = events.findIndex((event) => event.type === 'tool_use' && event.id === last)
  return callAt >= 0 && callAt < anchorAt
}

/** The Session's last topic call in `events`, folded once per array: the pane and the header are given the same one. */
const topicCalls = new WeakMap<readonly AgentEvent[], SessionTopicCall | null>()

function topicCallOf(events: readonly AgentEvent[]): SessionTopicCall | null {
  let found = topicCalls.get(events)
  if (found === undefined) {
    found = sessionTopicCall(foldTranscript(events))
    topicCalls.set(events, found)
  }
  return found
}

/**
 * The topic the Node's Mind map shows (worfy-polish ticket 173): the one of the Session's own last `mind_map_*` call
 * in its events — on this Machine and in a window on a Linked machine alike — unless a chip of another topic
 * switched it after that call; while the loaded events hold no such call, the one this window showed last for the
 * Node. A change of the Project's topics (`product.changed`), by any Session, does not switch it. `last` is the id
 * of that call and `anchor` the last of the events: the moment a chip's choice is made at.
 */
function useShownTopic(
  projectId: string,
  nodeId: string,
  events: readonly AgentEvent[] | undefined,
): { name: string | undefined; last: string | null; anchor: AgentEvent | null } {
  const key = `${projectId}:${nodeId}`
  const list = events ?? NO_EVENTS
  const session = useMemo(() => topicCallOf(list), [list])
  const chosen = useChosenTopics((topics) => topics[key])
  const last = session?.call ?? null
  const own = session?.topic
  useEffect(() => {
    if (own !== undefined) keepTopicName(key, own)
  }, [key, own])
  const holds = useMemo(() => chosen !== undefined && chipHolds(chosen, list, last), [chosen, list, last])
  const name = holds && chosen !== undefined ? chosen.name : (own ?? readTopicName(key))
  return { name, last, anchor: list.at(-1) ?? null }
}

/** The node of a chip whose topic the Node's Mind map is switching to, by `<projectId>:<nodeId>` (useTopicOfChip). */
const useChipTopics = create<Readonly<Record<string, NodeRef>>>(() => ({}))

function wantTopic(key: string, ref: NodeRef | null): void {
  useChipTopics.setState((all) => {
    const rest = { ...all }
    if (ref === null) delete rest[key]
    else rest[key] = ref
    return rest
  }, true)
}

/**
 * A chip of the chat names a node of a topic the map does not show (worfy-polish ticket 147, audit finding 63): the
 * Mind map of `shown` acts only on its own nodes. This reads the chip's topic; once it is read the map follows it,
 * and once that map is drawn the node is picked again on it, which selects it and brings it into view. A topic that
 * is gone or cannot be read says so in a toast, and the map stays as it was. The map stays on the chip's topic until
 * the Session's next call that names a topic (`last` and `anchor`, useShownTopic; worfy-polish ticket 173).
 */
function useTopicOfChip(projectId: string, nodeId: string, shown: ProductTopicState | null | undefined, last: string | null, anchor: AgentEvent | null): void {
  const key = `${projectId}:${nodeId}`
  const wanted = useChipTopics((all) => all[key]) ?? null
  const latest = useRef(shown?.name)
  useEffect(() => {
    latest.current = shown?.name
  })
  useEffect(
    () => {
      return useMindMapFocus.subscribe((state, before) => {
        const asked = state.picked
        if (asked === before.picked || asked === null || asked.projectId !== projectId || asked.topic === latest.current) return
        wantTopic(key, { projectId: asked.projectId, topic: asked.topic, id: asked.id })
      })
    },
    [projectId, key],
  )
  // Held until the map of the chip's topic is drawn, so the copy the map reads is never let go in between.
  const { topic, error } = useMindMap(projectId, wanted?.topic)
  useEffect(() => {
    if (wanted === null) return
    if (shown?.name === wanted.topic) {
      // Its map is drawn and listens now (MindMap.tsx): the pick acts on it.
      pickNode(wanted)
      wantTopic(key, null)
    } else if (topic !== undefined && topic !== null) {
      chooseTopic(key, { name: wanted.topic, since: last, anchor })
    } else if (topic === null || error !== undefined) {
      showToast({
        kind: 'error',
        key: `mind-map-topic:${wanted.topic}`,
        text: error === undefined ? `The Mind map has no topic "${wanted.topic}"` : `Could not read the Mind map topic "${wanted.topic}": ${error}`,
      })
      wantTopic(key, null)
    }
  }, [key, shown, wanted, topic, error, last, anchor])
}

/**
 * The topic of the Node's Mind map in the header of a Product Session (ticket 19, Q3): « · » and its title,
 * else its folder name while the topic is read; `fallback` (the Project's name) until a topic is known.
 * It reads the same shared copy of the topic as the Mind map pane (useMindMap), and takes the topic from the same
 * events of the Session (useShownTopic).
 */
export function ProductTopicName({
  projectId,
  nodeId,
  fallback,
  events,
}: {
  projectId: string
  nodeId: string
  fallback: string | undefined
  /** The Session's events, the loaded transcript and the live ones, as the pane is given them. */
  events?: readonly AgentEvent[] | undefined
}) {
  const { name } = useShownTopic(projectId, nodeId, events)
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

/**
 * The share of accepted advice of the Project, for the header of a Product Session, after the divider that sets
 * it apart. Nothing until main has answered, and nothing while the Project has no advice (owner, 2026-11-09, Q3);
 * a failed count shows, with why in its tooltip.
 */
export function AcceptedAdvice({ projectId }: { projectId: string }) {
  const { share, error } = useAdviceShare(projectId)
  const totals = share === undefined ? undefined : adviceTotals(share)
  if (error === undefined && (totals === undefined || totals.decided + totals.pending === 0)) return null
  const fact =
    totals !== undefined && share !== undefined && totals.decided === 0 ? (
      <span className="w-session__fact w-session__accepted" data-testid="product-session-accepted" title={adviceTitle(share)}>
        <span className="w-session__fact-value">No advice decided yet</span>
      </span>
    ) : (
      <span
        className="w-session__fact w-session__accepted"
        data-testid="product-session-accepted"
        title={error !== undefined ? `Could not count the advice: ${error}` : share === undefined ? undefined : adviceTitle(share)}
      >
        <span className="w-session__fact-label">Advice accepted</span>{' '}
        <span className="w-mono w-session__fact-value">
          {totals === undefined ? '—' : `${totals.accepted} of ${totals.decided} · ${Math.round((totals.accepted / totals.decided) * 100)}%`}
        </span>
      </span>
    )
  // The divider and the share give way together, first in the header: «…», then nothing (worfy-polish ticket 137).
  return (
    <span className="w-session__advice" data-testid="product-session-advice">
      <span className="w-session__divider" aria-hidden="true" />
      {fact}
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

const ICON_PROPS = { width: 17, height: 17, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true } as const

// The icons of the prototype's strip (card-2dffdc46): people, a shield with «!», a lamp, a page with lines.
const ICONS: Readonly<Record<RailPanel, ReactNode>> = {
  agents: (
    <svg {...ICON_PROPS}>
      <circle cx="7" cy="7" r="3" />
      <circle cx="14" cy="8.5" r="2.4" />
      <path d="M1.8 17c.6-3 2.6-4.6 5.2-4.6s4.6 1.6 5.2 4.6M12.5 12.6c2.6-.4 4.8.9 5.5 3.9" />
    </svg>
  ),
  critic: (
    <svg {...ICON_PROPS}>
      <path d="M10 2.5l6 2.3v4.6c0 3.9-2.5 6.6-6 8.1-3.5-1.5-6-4.2-6-8.1V4.8z" />
      <path d="M10 6.5v4.2M10 13.4v.2" />
    </svg>
  ),
  ideas: (
    <svg {...ICON_PROPS}>
      <path d="M10 2.5a5 5 0 0 0-3 9c.6.5 1 1.2 1 2V15h4v-1.5c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z" />
      <path d="M8 17.5h4" />
    </svg>
  ),
  drafts: (
    <svg {...ICON_PROPS}>
      <path d="M5 2.5h6.5L15 6v11.5H5z" />
      <path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h5" />
    </svg>
  ),
}

const NO_EVENTS: readonly AgentEvent[] = []

/** The panels of the strip, in its order (ticket 27, Q2 of 2026-11-09): one is open at a time. */
type RailPanel = 'agents' | 'critic' | 'ideas' | 'drafts'
const PANELS: readonly RailPanel[] = ['agents', 'critic', 'ideas', 'drafts']
const TITLES: Readonly<Record<RailPanel, string>> = { agents: 'Agents', critic: 'Critic', ideas: 'Idea generator', drafts: 'Drafts' }

interface AgentsStripProps {
  projectId: string
  agents: readonly SubagentInfo[]
  root: string | undefined
  session: string | null
  drafts: readonly ProductDraft[]
  chat: readonly AgentEvent[]
  busy: boolean
}

/**
 * The strip at the right edge: Agents, Critic, Idea generator and Drafts (ticket 27). A button opens its panel
 * in the column to its right, the column widening and the chat narrowing (ticket 22); another button switches to
 * its panel, the same one, «›» and Escape close it. Escape is taken anywhere in the strip and its panel: a clicked
 * button keeps the focus, so after «›» and a click on Agents again the key comes from the strip (ticket 36). With no
 * panel open the key passes on. The numbers are the agents and the drafts.
 */
function AgentsStrip({ projectId, agents, root, session, drafts, chat, busy }: AgentsStripProps) {
  const [open, setOpen] = useState<RailPanel | null>(null)
  const panelId = useId()
  const buttons = useRef(new Map<RailPanel, HTMLButtonElement>())
  const counts: Readonly<Record<RailPanel, number | undefined>> = { agents: agents.length, critic: undefined, ideas: undefined, drafts: drafts.length > 0 ? drafts.length : undefined }
  const close = () => {
    if (open !== null) buttons.current.get(open)?.focus()
    setOpen(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || open === null) return
    event.stopPropagation()
    close()
  }
  const panel = (shown: RailPanel): ReactNode => {
    if (shown === 'agents') return <ProductAgentsList agents={agents} root={root} session={session} />
    if (shown === 'critic') return <CriticPanel projectId={projectId} agents={agents} root={root} session={session} />
    if (shown === 'ideas') return <IdeasPanel projectId={projectId} agents={agents} root={root} session={session} chat={chat} busy={busy} />
    return <DraftsPanel projectId={projectId} drafts={drafts} />
  }
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Esc collapses the open panel: the keys come up from the strip's buttons and the panel's controls; it is not a control itself.
    <aside className="w-product__agents" aria-label="Agents" data-testid="product-agents" data-open={open !== null || undefined} onKeyDown={onKeyDown}>
      <div className="w-product__agents-strip">
        {PANELS.map((each) => {
          const count = counts[each]
          return (
            <button
              key={each}
              ref={(button) => {
                if (button === null) buttons.current.delete(each)
                else buttons.current.set(each, button)
              }}
              type="button"
              className="w-product__agents-button"
              aria-expanded={open === each}
              aria-controls={open === each ? panelId : undefined}
              // The count it shows is in its name too (axe, label-content-name-mismatch), not in brackets:
              // axe leaves a bracketed part out of the name it compares.
              aria-label={count === undefined ? TITLES[each] : `${TITLES[each]}: ${count}`}
              title={count === undefined ? TITLES[each] : `${TITLES[each]} (${count})`}
              data-testid={each === 'agents' ? 'product-agents-toggle' : `product-rail-${each}`}
              onClick={() => setOpen((was) => (was === each ? null : each))}
            >
              {ICONS[each]}
              {count !== undefined ? (
                <span className="w-product__agents-count w-mono" data-testid={each === 'agents' ? 'product-agents-count' : `product-rail-${each}-count`}>
                  {count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {open !== null ? (
        <div
          key={open}
          id={panelId}
          className="w-product__agents-panel"
          role="region"
          aria-label={TITLES[open]}
          data-testid={open === 'agents' ? 'product-agents-panel' : `product-rail-${open}-panel`}
          data-panel={open}
        >
          <div className="w-product__agents-head">
            {TITLES[open]}
            {counts[open] !== undefined ? <span className="w-product__agents-head-count w-mono">{counts[open]}</span> : null}
            <button type="button" className="w-product__agents-close" title="Collapse" aria-label={`Collapse the ${TITLES[open]} panel`} data-testid="product-agents-close" onClick={close}>
              ›
            </button>
          </div>
          {panel(open)}
        </div>
      ) : null}
    </aside>
  )
}

export function ProductSessionPanel({ children, events, busy = false, ...rail }: ProductSessionPanelProps) {
  const { share, move, commit } = useSplit()
  const session = rail.claudeSessionId ?? rail.sessionId
  const { agents, root } = useSessionAgents(rail.projectId, session)
  const drafts = useMemo(() => draftsOf(events ?? [], root), [events, root])
  const shown = useShownTopic(rail.projectId, rail.nodeId, events)
  const { topic, error } = useMindMap(rail.projectId, shown.name)
  useTopicOfChip(rail.projectId, rail.nodeId, topic, shown.last, shown.anchor)
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
      <AgentsStrip projectId={rail.projectId} agents={agents} root={root} session={session} drafts={drafts} chat={events ?? NO_EVENTS} busy={busy} />
    </div>
  )
}
