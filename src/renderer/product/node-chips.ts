// The chips of Mind map nodes under the messages of a Product Session's chat (Epic worfy-product-session,
// tickets 09 and 22), and what a chip and the Mind map tell each other in one window.
//
// The chips come from the transcript itself, with no new field in it (the spec, «decided without the owner»,
// item 4): every `mind_map_add`, `mind_map_update` and `mind_map_decide` call answers the node as it
// was written (src/main/mcp/mind-map-server.ts), so its result names the node, its text and kind, and
// the chat message (`message`, the uuid of the transcript event) the server stamped it with. A node's chip
// stands under the message that made it, as the owner's prototype has it (ticket 22): the last message of
// the turn drawn before its call — the advisor's answer the call follows, or the owner's prompt when the
// call comes before any answer. One message shows a node once, as its last call there left it. The chat
// draws no tool calls (ticket 19).
//
// The same results tell which row a node's `message` came in: a card's «Show in the chat» asks for that
// message (showMessage) and the Product Session's chat that has it scrolls to the row with the call's chip.
// A chip's click asks the Mind map to select the node and bring it into view (pickNode), its hover to
// light it (lightNode); the pointer on a message lights the nodes of all its chips (lightNodes). The
// requests carry the Project and the topic: a Mind map acts only on its own.
import { create } from 'zustand'
import { mindMapNodeSchema, type MindMapNode } from '../../shared/product/mind-map'
import { mindMapToolUseName, type MindMapToolName } from '../../shared/product/tools'
import type { TranscriptItem } from '../session/fold'

/**
 * What the calls under one message did to the node: `added` it, `changed` a node that was there, or
 * `overturned` a Decision — turned its status the other way (mind_map_decide).
 */
export type ChipChange = 'added' | 'changed' | 'overturned'

/** A node the calls under a message wrote: the topic it is in, the node as the last call answered it, and what they did. */
export interface NodeChip {
  topic: string
  node: MindMapNode
  change: ChipChange
}

/** The calls whose answer is the node as written; mind_map_remove answers only the id it removed. */
const WRITING_TOOLS: ReadonlyMap<string, MindMapToolName> = new Map((['mind_map_add', 'mind_map_update', 'mind_map_decide'] as const).map((name) => [mindMapToolUseName(name), name]))

/** What a call did to the node it answered: a Decision whose status differs from its last earlier state was overturned. */
function changeOf(tool: MindMapToolName, node: MindMapNode): ChipChange {
  if (tool === 'mind_map_add') return 'added'
  const before = node.history?.at(-1)
  return tool === 'mind_map_decide' && before !== undefined && before.status !== node.status ? 'overturned' : 'changed'
}

/** The node a successful writing call answered, with its topic; null for any other call. */
function writtenNode(call: { name: string; input: unknown; result: { content: string; isError: boolean } | null }): NodeChip | null {
  const tool = WRITING_TOOLS.get(call.name)
  if (tool === undefined || call.result === null || call.result.isError) return null
  const topic = typeof call.input === 'object' && call.input !== null ? (call.input as { topic?: unknown }).topic : undefined
  if (typeof topic !== 'string') return null
  let answer: unknown
  try {
    answer = JSON.parse(call.result.content)
  } catch {
    return null
  }
  const node = mindMapNodeSchema.safeParse(answer)
  return node.success ? { topic, node: node.data, change: changeOf(tool, node.data) } : null
}

const KIND: Readonly<Record<NodeChip['node']['kind'], string>> = { idea: 'Idea', question: 'Question', decision: 'Decision', objection: 'Objection' }

/** The chip's line: what the calls did, the kind (a Decision with its status mark) and the node's text. */
export function chipLabel({ node, change }: NodeChip): string {
  if (change === 'overturned') return `↺ “${node.text}” → ${node.status ?? 'changed'}`
  const kind = node.kind === 'decision' ? `${KIND.decision} ${node.status === 'rejected' ? '✕' : '✓'}` : KIND[node.kind]
  return `${change === 'added' ? '+ ' : ''}${kind}: ${node.text}`
}

/** One node's calls under one message as one chip: the node as the later left it; added there stays added, an overturn shows. */
function merged(earlier: NodeChip, later: NodeChip): NodeChip {
  const change = earlier.change === 'added' || later.change === 'added' ? 'added' : earlier.change === 'overturned' || later.change === 'overturned' ? 'overturned' : 'changed'
  return { ...later, change }
}

export interface TranscriptChips {
  /**
   * The chips of each row that shows any: the key of the last message of the turn (a prompt or an answer)
   * drawn before the call; without one (the turn starts before the rows held), of the next row of the turn
   * drawn. Calls of a turn with no row drawn after them hang on the next row drawn after the turn, or, with
   * none after it, on CHIPS_AT_END: the end of the chat.
   */
  byRow: ReadonlyMap<string, readonly NodeChip[]>
  /** The row with the chip of the call a chat message (a node's `message`) came in, by the message's uuid. */
  rowOfMessage: ReadonlyMap<string, string>
}

/** The key of the chips the chat shows at its end, under «Advisor is thinking» while a turn runs (ticket 19). */
export const CHIPS_AT_END = 'end'

const NONE: TranscriptChips = { byRow: new Map(), rowOfMessage: new Map() }

const chipKey = (chip: NodeChip): string => `${chip.topic}\n${chip.node.id}`

/**
 * The chips of a transcript's messages, and the rows that show the calls the nodes' messages came in.
 * `shown` tells the rows the chat draws (session/product-session.ts, shownInProductChat): a chip never
 * hangs on a row that is not drawn.
 */
export function transcriptChips(items: readonly TranscriptItem[], shown: (item: TranscriptItem) => boolean): TranscriptChips {
  const rows = new Map<string, Map<string, NodeChip>>()
  const rowOfMessage = new Map<string, string>()
  // The message of the turn drawn last: the chips of the calls after it go under it.
  let message: string | null = null
  // The calls with no row of their turn drawn before them, waiting for the next row drawn.
  let waiting: NodeChip[] = []
  const put = (row: string, chips: readonly NodeChip[]): void => {
    const into = rows.get(row) ?? new Map<string, NodeChip>()
    rows.set(row, into)
    for (const chip of chips) {
      const key = chipKey(chip)
      const was = into.get(key)
      // A node written twice under one message is one chip, where its first call put it.
      into.set(key, was === undefined ? chip : merged(was, chip))
      if (chip.node.message !== undefined && !rowOfMessage.has(chip.node.message)) rowOfMessage.set(chip.node.message, row)
    }
  }
  for (const item of items) {
    if (item.kind === 'prompt') message = null
    if (shown(item)) {
      if (item.kind === 'prompt' || item.kind === 'text') message = item.key
      if (waiting.length > 0) {
        put(item.key, waiting)
        waiting = []
      }
    }
    if (item.kind !== 'tools') continue
    for (const call of item.calls) {
      const chip = writtenNode(call)
      if (chip === null) continue
      if (message !== null) put(message, [chip])
      else waiting.push(chip)
    }
  }
  if (waiting.length > 0) put(CHIPS_AT_END, waiting)
  if (rows.size === 0) return NONE
  return { byRow: new Map([...rows].map(([row, chips]) => [row, [...chips.values()]])), rowOfMessage }
}

/** A node of a topic of a Project, as a chip names it. */
export interface NodeRef {
  projectId: string
  topic: string
  id: string
}

interface FocusState {
  /** The node a chip's click asked for; `seq` grows with each click, so a second click on it acts again. */
  picked: (NodeRef & { seq: number }) | null
  /** The node under the pointer or the focus on a chip; while there is one, it alone is lit. */
  lit: NodeRef | null
  /** The nodes of the chips of the chat message under the pointer (ticket 19); none: empty. */
  litMessage: readonly NodeRef[]
  /** The chat message a card asked to see; `seq` as for `picked`. */
  shown: { projectId: string; message: string; seq: number } | null
  /** How many Product Session chats of each Project are on screen: a card offers «Show in the chat» only with one. */
  chats: Readonly<Record<string, number>>
}

export const useMindMapFocus = create<FocusState>(() => ({ picked: null, lit: null, litMessage: [], shown: null, chats: {} }))

let seq = 0

/** Selects the node on its Mind map and brings it into view. */
export function pickNode(ref: NodeRef): void {
  useMindMapFocus.setState({ picked: { ...ref, seq: ++seq } })
}

/** Lights the node on its Mind map; null puts the light out. */
export function lightNode(ref: NodeRef | null): void {
  useMindMapFocus.setState({ lit: ref })
}

/** Lights the nodes of a chat message's chips on their Mind map; an empty list puts the light out. */
export function lightNodes(refs: readonly NodeRef[]): void {
  useMindMapFocus.setState({ litMessage: refs })
}

/** Asks the Project's Product Session chat to scroll to a message. */
export function showMessage(projectId: string, message: string): void {
  useMindMapFocus.setState({ shown: { projectId, message, seq: ++seq } })
}

/** A Product Session chat of the Project is on screen until the returned function is called. */
export function attachChat(projectId: string): () => void {
  const change = (by: number): void =>
    useMindMapFocus.setState(({ chats }) => {
      const count = (chats[projectId] ?? 0) + by
      const next = { ...chats }
      if (count > 0) next[projectId] = count
      else delete next[projectId]
      return { chats: next }
    })
  change(1)
  return () => change(-1)
}
