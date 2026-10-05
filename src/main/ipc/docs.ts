import { app, type WebContents } from 'electron'
import { docsChanged, docsClose, docsOpen, docsRead, HANDOFF_HEIGHT, HANDOFF_KIND, HANDOFF_WIDTH } from '../../shared/ipc/docs'
import { SOURCE_NODE_KINDS } from '../../shared/layout/derived'
import type { LayoutNode } from '../../shared/layout/types'
import { DocsHub, readDoc, type DocsSubscriber } from '../docs/watch'
import { layoutStore } from '../layout/store'
import { projectStore } from '../projects/store'
import { defineHandler, emit, type HandlerModule } from './index'

// The `docs` channels (src/shared/ipc/docs.ts) and the HANDOFF Node.
//
// The HANDOFF Node is a Layout Node of kind `handoff`, created locked (it can be moved and
// resized, not removed) the first time the Project is seen with a HANDOFF.md. While the file is
// gone the Node is hidden, and shown again when the file comes back; a Node the user hid stays
// hidden. Its text is never copied into the Layout: the Node reads it through `docs.read`.

const GAP = 40

/**
 * Where a new HANDOFF Node goes: the top-left spot when it is free, otherwise under every Node on
 * the plane, so it covers none of them and is in view with the default viewport (the Orchestrator
 * Node is placed the same way).
 */
export function handoffPlace(nodes: readonly LayoutNode[]): { x: number; y: number } {
  // Epic frame Nodes keep offsets, not places (shared/layout/derived.ts); pinned ones keep screen pixels.
  const placed = nodes.filter((node) => !node.pinned && !node.hidden && !SOURCE_NODE_KINDS.includes(node.kind))
  const spot = { x: GAP, y: GAP }
  const covers = (node: LayoutNode) =>
    node.x < spot.x + HANDOFF_WIDTH && spot.x < node.x + node.w && node.y < spot.y + HANDOFF_HEIGHT && spot.y < node.y + node.h
  if (!placed.some(covers)) return spot
  return { x: Math.min(...placed.map((node) => node.x)), y: Math.max(...placed.map((node) => node.y + node.h)) + GAP }
}

/** Brings the Project's HANDOFF Node in line with whether HANDOFF.md exists. */
export function syncHandoffNode(projectId: string, exists: boolean): void {
  const store = layoutStore()
  const { layout } = store.get(projectId)
  const node = layout.nodes.find((candidate) => candidate.kind === HANDOFF_KIND)
  if (exists) {
    if (!node) {
      const { x, y } = handoffPlace(layout.nodes)
      store.apply(projectId, { op: 'create', node: { kind: HANDOFF_KIND, x, y, w: HANDOFF_WIDTH, h: HANDOFF_HEIGHT, locked: true, data: {} } })
    } else if (node.hidden && node.data.missing === true) {
      store.apply(projectId, { op: 'hide', id: node.id, hidden: false })
      store.apply(projectId, { op: 'patchData', id: node.id, data: { missing: false } })
    }
  } else if (node && !node.hidden) {
    // `missing` tells this hide from the user's own, so only this one is undone.
    store.apply(projectId, { op: 'patchData', id: node.id, data: { missing: true } })
    store.apply(projectId, { op: 'hide', id: node.id, hidden: true })
  }
}

/** One hub for the app: one watcher per Project, shared by the windows that opened it and by main. */
export const docsHub = new DocsHub({
  onState: ({ projectId, handoff }) => {
    try {
      syncHandoffNode(projectId, handoff !== null)
    } catch (error) {
      // The Project was removed from the list while its watcher still reported.
      console.warn(`[docs] could not update the HANDOFF Node of ${projectId}`, error)
    }
  },
})

const subscribed = new WeakSet<WebContents>()

/** The window that called, as a subscriber; it leaves every Project when it is destroyed. */
function subscriberOf(sender: WebContents): DocsSubscriber {
  if (!subscribed.has(sender)) {
    subscribed.add(sender)
    sender.once('destroyed', () => void docsHub.drop(sender.id))
  }
  return {
    id: sender.id,
    send: (state) => {
      if (!sender.isDestroyed()) emit(sender, docsChanged, state)
    },
  }
}

// main keeps the active Project's documents open itself, so its HANDOFF Node follows the file
// whether or not a view in the window asked for them (the sidebar can be hidden).
const MAIN = 'main'
const mainSubscriber: DocsSubscriber = { id: MAIN, send: () => undefined }
let kept: string | null = null

function keepActive(): void {
  let active
  try {
    active = projectStore().active()
  } catch (error) {
    console.error('[docs] could not read the active Project', error)
    return
  }
  const next = active?.id ?? null
  if (next === kept) return
  if (kept !== null) void docsHub.close(kept, MAIN)
  kept = next
  if (active) {
    docsHub.open(active.id, active.path, mainSubscriber).catch((error: unknown) => {
      console.error(`[docs] could not watch the documents of ${active.id}`, error)
      if (kept === active.id) kept = null
    })
  }
}

// Subscribing reads nothing: the Project list is read once a window exists.
app.on('browser-window-created', keepActive)
projectStore().onChange(keepActive)
app.on('will-quit', () => void docsHub.closeAll())

export default [
  defineHandler(docsOpen, ({ projectId }, { event }) => docsHub.open(projectId, projectStore().get(projectId).path, subscriberOf(event.sender))),
  defineHandler(docsClose, async ({ projectId }, { event }) => ({ closed: await docsHub.close(projectId, event.sender.id) })),
  defineHandler(docsRead, ({ projectId, path }) => readDoc(projectStore().get(projectId).path, path)),
] satisfies HandlerModule
