// The chips of Mind map nodes under the advisor's messages (Epic worfy-product-session, ticket 09), and
// what a chip and the Mind map tell each other in one window.
//
// The chips come from the transcript itself, with no new field in it (the spec, «decided without the owner»,
// item 4): every `mind_map_add`, `mind_map_update` and `mind_map_decide` call answers the node as it
// was written (src/main/mcp/mind-map-server.ts), so its result names the node, its text and kind, and
// the chat message (`message`, the uuid of the transcript event) the server stamped it with. A turn — the
// rows from one prompt to the next — shows the nodes its calls wrote under its last answer, each node
// once, as its last call left it.
//
// The same results tell which row of the chat a node's `message` came in: a card's «Show in the chat»
// asks for that message (showMessage) and the Product Session's chat that has it scrolls to the row.
// A chip's click asks the Mind map to select the node and bring it into view (pickNode), its hover to
// light it (lightNode). The requests carry the Project and the topic: a Mind map acts only on its own.
import { create } from 'zustand'
import { mindMapNodeSchema, type MindMapNode } from '../../shared/product/mind-map'
import { mindMapToolUseName } from '../../shared/product/tools'
import type { TranscriptItem } from '../session/fold'

/** A node a call of the turn wrote: the topic it is in and the node as the call answered it. */
export interface NodeChip {
  topic: string
  node: MindMapNode
}

/** The calls whose answer is the node as written; mind_map_remove answers only the id it removed. */
const WRITING_TOOLS: ReadonlySet<string> = new Set((['mind_map_add', 'mind_map_update', 'mind_map_decide'] as const).map(mindMapToolUseName))

/** The node a successful writing call answered, with its topic; null for any other call. */
function writtenNode(call: { name: string; input: unknown; result: { content: string; isError: boolean } | null }): NodeChip | null {
  if (!WRITING_TOOLS.has(call.name) || call.result === null || call.result.isError) return null
  const topic = typeof call.input === 'object' && call.input !== null ? (call.input as { topic?: unknown }).topic : undefined
  if (typeof topic !== 'string') return null
  let answer: unknown
  try {
    answer = JSON.parse(call.result.content)
  } catch {
    return null
  }
  const node = mindMapNodeSchema.safeParse(answer)
  return node.success ? { topic, node: node.data } : null
}

export interface TranscriptChips {
  /** The chips of each row that shows any: the key of the turn's last answer (or of its last run of calls without one). */
  byRow: ReadonlyMap<string, readonly NodeChip[]>
  /** The row whose call a chat message (a node's `message`) came in, by the message's uuid. */
  rowOfMessage: ReadonlyMap<string, string>
}

const NONE: TranscriptChips = { byRow: new Map(), rowOfMessage: new Map() }

/** The chips of a transcript's turns, and the rows the nodes' messages came in. */
export function transcriptChips(items: readonly TranscriptItem[]): TranscriptChips {
  const byRow = new Map<string, NodeChip[]>()
  const rowOfMessage = new Map<string, string>()
  let turn = new Map<string, NodeChip>()
  let answer: string | null = null
  let lastCalls: string | null = null
  const close = (): void => {
    const row = answer ?? lastCalls
    if (row !== null && turn.size > 0) byRow.set(row, [...turn.values()])
    turn = new Map()
    answer = null
    lastCalls = null
  }
  for (const item of items) {
    if (item.kind === 'prompt') close()
    else if (item.kind === 'text' && !item.synthetic) answer = item.key
    else if (item.kind === 'tools') {
      for (const call of item.calls) {
        const chip = writtenNode(call)
        if (chip === null) continue
        const key = `${chip.topic}\n${chip.node.id}`
        // A node written twice in a turn is one chip, where its first call put it, as the last call left it.
        turn.set(key, chip)
        lastCalls = item.key
        if (chip.node.message !== undefined && !rowOfMessage.has(chip.node.message)) rowOfMessage.set(chip.node.message, item.key)
      }
    }
  }
  close()
  return byRow.size === 0 && rowOfMessage.size === 0 ? NONE : { byRow, rowOfMessage }
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
  /** The node under the pointer or the focus on a chip. */
  lit: NodeRef | null
  /** The chat message a card asked to see; `seq` as for `picked`. */
  shown: { projectId: string; message: string; seq: number } | null
  /** How many Product Session chats of each Project are on screen: a card offers «Show in the chat» only with one. */
  chats: Readonly<Record<string, number>>
}

export const useMindMapFocus = create<FocusState>(() => ({ picked: null, lit: null, shown: null, chats: {} }))

let seq = 0

/** Selects the node on its Mind map and brings it into view. */
export function pickNode(ref: NodeRef): void {
  useMindMapFocus.setState({ picked: { ...ref, seq: ++seq } })
}

/** Lights the node on its Mind map; null puts the light out. */
export function lightNode(ref: NodeRef | null): void {
  useMindMapFocus.setState({ lit: ref })
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
