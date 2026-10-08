import { workflowChanged, workflowClose, workflowOpen } from '../../shared/ipc/workflow'
import { ClientHolders, clientOf, type Client } from '../clients'
import { insideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { WorkflowHub, type WorkflowSubscriber } from '../workflow/watch'
import { defineHandler, emit, type HandlerModule } from './index'

/** One hub for the app: one watcher per Project, shared by the clients that opened it. */
export const workflowHub = new WorkflowHub({ claudeHome: claudeHome() })

/** The client holding each id leaves every Project when it is destroyed or another client takes its id. */
const holders = new ClientHolders((id) => void workflowHub.drop(id))

/** The client that called, as a subscriber. */
function subscriberOf(client: Client | undefined): WorkflowSubscriber {
  if (client === undefined) throw new Error('workflow.open: the call came from no client')
  if (!holders.hold(client)) throw new Error('workflow.open: the client is gone')
  return {
    id: client.id,
    send: (delta) => {
      if (!client.isDestroyed()) emit(client, workflowChanged, delta)
    },
  }
}

export default [
  defineHandler(workflowOpen, ({ root }, { event }) => {
    // A Linked machine opens the Projects of the list only (src/main/link/caller.ts).
    insideProjects(event, root, () => projectStore().list(), 'the Project root')
    return workflowHub.open(root, subscriberOf(clientOf(event)))
  }),
  defineHandler(workflowClose, async ({ root }, { event }) => {
    const client = clientOf(event)
    return { closed: client === undefined ? false : await workflowHub.close(root, client.id) }
  }),
] satisfies HandlerModule
