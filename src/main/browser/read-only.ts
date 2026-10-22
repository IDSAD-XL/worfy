// What a read-only Linked machine may see of a Browser (ADR-0078 item 14, ADR-0066; worfy-browser
// ticket 07): only its frame with the name of its Browser profile. The frames, the input, the lives
// and the picture of an Asleep page are `write` channels (src/shared/ipc/browser.ts) and never reach
// it. The Layout does — `layout.get` and `layout.changed` are `read` — and a Browser Node keeps its
// address in `data.url` (worfy-browser ticket 02), so main takes that key out of every Layout and every
// operation it sends such a Machine (src/main/ipc/layout.ts). The rest of the Node — its place, its
// size, its profile — stays: the frame is drawn from it.
import type { Client } from '../clients'
import { LinkSender } from '../link/ipc-adapter'
import { BROWSER_KIND as BROWSER } from '../../shared/browser/tools'
import type { LayoutChangeEvent } from '../../shared/ipc/layout'
import type { LayoutNode, LayoutOp, LayoutState } from '../../shared/layout/types'


/** Whether `client` is the client of a Linked machine with read-only access. */
export function readOnlyClient(client: Client | undefined): boolean {
  return client instanceof LinkSender && client.readOnly
}

/** `data` without the address. */
function withoutUrl(data: LayoutNode['data']): LayoutNode['data'] {
  if (!('url' in data)) return data
  const rest = { ...data }
  delete rest.url
  return rest
}

const nodeWithoutUrl = (node: LayoutNode): LayoutNode => (node.kind === BROWSER && 'url' in node.data ? { ...node, data: withoutUrl(node.data) } : node)

/** The Layout of `state` without the address of any Browser Node. */
export function layoutWithoutUrls<S extends LayoutState>(state: S): S {
  if (!state.layout.nodes.some((node) => node.kind === BROWSER && 'url' in node.data)) return state
  return { ...state, layout: { ...state.layout, nodes: state.layout.nodes.map(nodeWithoutUrl) } }
}

/** The operation `op` of a change of `nodes` without the address of a Browser Node: a new one's, or a patch's of one. */
function opWithoutUrl(op: LayoutOp, nodes: readonly LayoutNode[]): LayoutOp {
  if (op.op === 'create' && op.node.kind === BROWSER && 'url' in op.node.data) return { ...op, node: { ...op.node, data: withoutUrl(op.node.data) } }
  // A patch of a Node that is not in the Layout after it is taken as a Browser's: nothing tells otherwise.
  if (op.op === 'patchData' && 'url' in op.data && (nodes.find((node) => node.id === op.id)?.kind ?? BROWSER) === BROWSER) return { ...op, data: withoutUrl(op.data) }
  return op
}

/** A change of a Layout as a read-only Linked machine gets it: no address of a Browser in its Layout or in its operation. */
export function changeWithoutUrls(change: LayoutChangeEvent): LayoutChangeEvent {
  const next = layoutWithoutUrls(change)
  const op = opWithoutUrl(change.op, change.layout.nodes)
  return op === change.op ? next : { ...next, op }
}
