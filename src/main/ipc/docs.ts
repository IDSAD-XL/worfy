import { app } from 'electron'
import { docsChanged, docsClose, docsOpen, docsRead, HANDOFF_HEIGHT, HANDOFF_KIND, HANDOFF_WIDTH } from '../../shared/ipc/docs'
import type { LayoutNode } from '../../shared/layout/types'
import { ClientHolders, clientOf, type Client } from '../clients'
import { DocsHub, readDoc, type DocsSubscriber } from '../docs/watch'
import { placeNewNode } from '../layout/place'
import { layoutStore } from '../layout/store'
import { projectHolds } from '../projects/holds'
import { projectStore } from '../projects/store'
import { projectLayouts } from '../workflow/folder'
import { defineHandler, emit, type HandlerModule } from './index'

// The `docs` channels (src/shared/ipc/docs.ts) and the HANDOFF Node.
//
// The HANDOFF Node is a Layout Node of kind `handoff`, created locked (it can be moved and
// resized, not removed) the first time the Project is seen with a HANDOFF.md. While the file is
// gone the Node is hidden, and shown again when the file comes back; a Node the user hid stays
// hidden. Its text is never copied into the Layout: the Node reads it through `docs.read`.
//
// The documents are those of the Project's Workflow folder (ADR-0042): the Project root in Full
// mode, the Workflow folder outside the repository in Silent mode (src/main/workflow/folder.ts).

/** Where the Project at `path` keeps HANDOFF.md and docs/adr. */
export async function docsRoot(path: string): Promise<string> {
  return (await docsSource(path)).root
}

/** Where the Project at `path` keeps its documents, and the label of its ADRs' status line (the Profile's). */
export async function docsSource(path: string): Promise<{ root: string; adrStatusLabel: string | undefined }> {
  const layout = await projectLayouts().get(path)
  return { root: layout.mode === 'silent' ? layout.workflowFolder : path, adrStatusLabel: layout.headings?.adrStatusLabel }
}

/** Where a new HANDOFF Node goes: the same rule as the Orchestrator Node (src/main/layout/place.ts). */
export function handoffPlace(nodes: readonly LayoutNode[]): { x: number; y: number } {
  return placeNewNode(nodes, { w: HANDOFF_WIDTH, h: HANDOFF_HEIGHT })
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
    } else if (node.data.missing === true) {
      // The file is back: undo main's own hide. The mark goes even when someone (the user, or an
      // agent through the canvas tools) showed the Node while the file was gone; otherwise a later
      // hide of theirs would be taken for main's and undone.
      if (node.hidden) store.apply(projectId, { op: 'hide', id: node.id, hidden: false })
      store.apply(projectId, { op: 'patchData', id: node.id, data: { missing: false } })
    }
  } else if (node && !node.hidden) {
    // `missing` tells this hide from the user's own, so only this one is undone.
    store.apply(projectId, { op: 'patchData', id: node.id, data: { missing: true } })
    store.apply(projectId, { op: 'hide', id: node.id, hidden: true })
  }
}

/** One hub for the app: one watcher per Project, shared by the clients that opened it and by main. */
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

/** The client holding each id leaves every Project when it is destroyed or another client takes its id. */
const holders = new ClientHolders((id) => void docsHub.drop(id))

/** The client that called, as a subscriber. */
function subscriberOf(client: Client | undefined): DocsSubscriber {
  if (client === undefined) throw new Error('docs.open: the call came from no client')
  if (!holders.hold(client)) throw new Error('docs.open: the client is gone')
  return {
    id: client.id,
    send: (state) => {
      if (!client.isDestroyed()) emit(client, docsChanged, state)
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
    docsSource(active.path)
      .then(({ root, adrStatusLabel }) => (kept === active.id ? docsHub.open(active.id, root, mainSubscriber, adrStatusLabel) : undefined))
      .catch((error: unknown) => {
        console.error(`[docs] could not watch the documents of ${active.id}`, error)
        if (kept === active.id) kept = null
      })
  }
}

// The Projects screens of Linked machines show (worfy-link ticket 09) are kept open the same way,
// under a subscriber of their own: one of them may be the active Project as well.
const HELD = 'held'
const heldSubscriber: DocsSubscriber = { id: HELD, send: () => undefined }
const keptHeld = new Set<string>()

/** Opens the documents of every held Project not open yet, and closes those no screen holds any more. */
export function keepHeld(): void {
  const held = projectHolds().projectIds()
  for (const projectId of [...keptHeld]) {
    if (held.has(projectId)) continue
    keptHeld.delete(projectId)
    void docsHub.close(projectId, HELD)
  }
  for (const projectId of held) {
    if (keptHeld.has(projectId)) continue
    let path: string
    try {
      path = projectStore().get(projectId).path
    } catch (error) {
      console.warn(`[docs] could not keep the documents of the held Project ${projectId}`, error)
      continue
    }
    keptHeld.add(projectId)
    docsSource(path)
      .then(({ root, adrStatusLabel }) => (keptHeld.has(projectId) ? docsHub.open(projectId, root, heldSubscriber, adrStatusLabel) : undefined))
      .catch((error: unknown) => {
        console.error(`[docs] could not watch the documents of ${projectId}`, error)
        keptHeld.delete(projectId)
      })
  }
}

// Subscribing reads nothing: the Project list is read once a window exists.
app.on('browser-window-created', keepActive)
projectStore().onChange(keepActive)
projectHolds().onChange(keepHeld)
app.on('will-quit', () => void docsHub.closeAll())

export default [
  defineHandler(docsOpen, async ({ projectId }, { event }) => {
    const subscriber = subscriberOf(clientOf(event))
    const { root, adrStatusLabel } = await docsSource(projectStore().get(projectId).path)
    return docsHub.open(projectId, root, subscriber, adrStatusLabel)
  }),
  defineHandler(docsClose, async ({ projectId }, { event }) => {
    const client = clientOf(event)
    return { closed: client === undefined ? false : await docsHub.close(projectId, client.id) }
  }),
  defineHandler(docsRead, async ({ projectId, path }) => readDoc(await docsRoot(projectStore().get(projectId).path), path)),
] satisfies HandlerModule
