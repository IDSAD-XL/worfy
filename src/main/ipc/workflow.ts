import { workflowChanged, workflowClose, workflowOpen } from '../../shared/ipc/workflow'
import { ClientHolders, clientOf, type Client } from '../clients'
import { harnessScriptEnv } from '../harness/script-env'
import { insideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { WorkflowHub, type WorkflowSubscriber } from '../workflow/watch'
import { defineHandler, emit, type HandlerModule } from './index'

/** One hub for the app: one watcher per Project, shared by the clients that opened it. */
export const workflowHub = new WorkflowHub({ claudeHome: claudeHome(), env: harnessScriptEnv })

export interface WorkflowHandlersOptions {
  hub: Pick<WorkflowHub, 'open' | 'close' | 'drop'>
  projects?: () => readonly { readonly path: string }[]
}

/**
 * The handlers over a hub; a Linked machine opens the Projects of the list only
 * (src/main/link/caller.ts). The hub keys a Project by path.resolve, and its model and deltas carry
 * that root; each client gets them with the root as it sent it, since the window looks the root up
 * by its own string. On Windows the window keeps git's `C:/…` while path.resolve gives `C:\…`
 * (worfy-windows ticket 63).
 */
export function workflowHandlers(options: WorkflowHandlersOptions): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  /** The client holding each id leaves every Project when it is destroyed or another client takes its id. */
  const holders = new ClientHolders((id) => void options.hub.drop(id))
  /** The client that called, as a subscriber of the root it spelled `asSent`. */
  const subscriberOf = (client: Client | undefined, asSent: string): WorkflowSubscriber => {
    if (client === undefined) throw new Error('workflow.open: the call came from no client')
    if (!holders.hold(client)) throw new Error('workflow.open: the client is gone')
    return {
      id: client.id,
      send: (delta) => {
        if (!client.isDestroyed()) emit(client, workflowChanged, { ...delta, root: asSent })
      },
    }
  }
  return [
    defineHandler(workflowOpen, async ({ root }, { event }) => {
      insideProjects(event, root, projects, 'the Project root')
      return { ...(await options.hub.open(root, subscriberOf(clientOf(event), root))), root }
    }),
    defineHandler(workflowClose, async ({ root }, { event }) => {
      const client = clientOf(event)
      return { closed: client === undefined ? false : await options.hub.close(root, client.id) }
    }),
  ]
}

export default workflowHandlers({ hub: workflowHub })
