import { workflowChanged, workflowClose, workflowOpen } from '../../shared/ipc/workflow'
import { clientOf, type Client } from '../clients'
import { claudeHome } from '../storage/paths'
import { WorkflowHub, type WorkflowSubscriber } from '../workflow/watch'
import { defineHandler, emit, type HandlerModule } from './index'

/** One hub for the app: one watcher per Project, shared by the clients that opened it. */
export const workflowHub = new WorkflowHub({ claudeHome: claudeHome() })

const subscribed = new WeakSet<Client>()

/** The client that called, as a subscriber; it leaves every Project when it is destroyed. */
function subscriberOf(client: Client | undefined): WorkflowSubscriber {
  if (client === undefined) throw new Error('workflow.open: the call came from no client')
  if (!subscribed.has(client)) {
    subscribed.add(client)
    client.once('destroyed', () => void workflowHub.drop(client.id))
  }
  return {
    id: client.id,
    send: (delta) => {
      if (!client.isDestroyed()) emit(client, workflowChanged, delta)
    },
  }
}

export default [
  defineHandler(workflowOpen, ({ root }, { event }) => workflowHub.open(root, subscriberOf(clientOf(event)))),
  defineHandler(workflowClose, async ({ root }, { event }) => {
    const client = clientOf(event)
    return { closed: client === undefined ? false : await workflowHub.close(root, client.id) }
  }),
] satisfies HandlerModule
