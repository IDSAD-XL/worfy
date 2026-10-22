// Handlers of the `trash` domain (src/shared/ipc/trash.ts): the Nodes the user deleted, kept in
// each Project's data folder (src/main/layout/trash.ts). When the app starts, entries older than
// three days are deleted from the trash of every Project in the list.
import { trashChanged, trashList, trashPut, trashRestore } from '../../shared/ipc/trash'
import { sharedNodeSessions } from '../agent/app-node-sessions'
import { toEveryWindow } from '../broadcast'
import { cardDataStore } from '../cards/data'
import { cardStore } from '../cards/store'
import { layoutStore } from '../layout/store'
import { TrashStore } from '../layout/trash'
import { projectStore } from '../projects/store'
import { defineHandler, emit, type HandlerModule } from './index'

const SESSION_NODE_KIND = 'session'

const store = new TrashStore({
  dataDirOf: (projectId) => {
    const projects = projectStore()
    return projects.dataDir(projects.get(projectId).id)
  },
  // The Card's files where the Card stores keep them: the trash does not lay them out itself.
  cardPaths: (projectId, cardId) => ({ folder: cardStore().cardDir(projectId, cardId), data: cardDataStore().file(projectId, cardId) }),
  layout: layoutStore(),
  // A Session worfy runs on the Node: it is closed first, as the Node's own Remove button asks.
  busy: (projectId, node) => {
    if (node.kind !== SESSION_NODE_KIND) return null
    const view = sharedNodeSessions()
      .list(projectId)
      .find((each) => each.nodeId === node.id)
    return view !== undefined && view.state !== 'closed' ? `A Session runs on Node ${node.id}; close the Session before deleting its Node` : null
  },
})

function changed(projectId: string): void {
  toEveryWindow((client) => emit(client, trashChanged, { projectId }))
}

// Start-up cleanup. Deferred, so loading the handlers never waits on the disk; one Project that
// cannot be cleaned does not keep the others from it, and one entry that cannot be removed does
// not keep the other entries of its Project (worfy-windows ticket 44): it stays in the trash, is
// named here, and is tried again at the next start.
setTimeout(() => {
  for (const { id } of projectStore().list()) {
    try {
      const { removed, refused } = store.purge(id)
      for (const { label, error } of refused) console.error(`[trash] could not delete entry ${label} from the trash of ${id}; it is left there`, error)
      if (removed.length > 0) changed(id)
    } catch (error) {
      console.error(`[trash] could not clean the trash of ${id}`, error)
    }
  }
}, 0)

export default [
  // `screen`: the screen whose recorded gesture or undo this is; the Layout change carries it in
  // `layout.changed` (worfy-link ticket 07).
  defineHandler(trashPut, async ({ projectId, nodeId, screen, keep }) => {
    // The pages of a Session's Browsers are asked for unsaved changes first (src/main/layout/store.ts).
    await layoutStore().askBrowsersFirst(projectId, { op: 'remove', id: nodeId })
    const entry = store.put(projectId, nodeId, screen ?? null, keep)
    changed(projectId)
    return entry
  }),
  defineHandler(trashRestore, ({ projectId, label, screen }) => {
    const entry = store.restore(projectId, label, screen ?? null)
    changed(projectId)
    return entry
  }),
  defineHandler(trashList, ({ projectId }) => ({ entries: store.list(projectId) })),
] satisfies HandlerModule
