import { resolve } from 'node:path'
import { workflowChanged, workflowClose, workflowOpen } from '../../shared/ipc/workflow'
import { ClientHolders, clientOf, type Client, type ClientId } from '../clients'
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
  /** Where the opens' roots are kept; a test passes its own to see them. */
  opened?: OpenedRoots
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
  const opened = options.opened ?? new OpenedRoots()
  /** The client holding each id leaves every Project when it is destroyed or another client takes its id. */
  const holders = new ClientHolders((id) => {
    opened.forget(id)
    void options.hub.drop(id)
  })
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
      // The root the hub watches: a window's as it came, so it meets the hub's other subscribers
      // (Autopilot, the Stage hub, waits-notify) under path.resolve; for a Linked machine the real
      // path the check answered, so a link swapped in after the check does not lead the watch elsewhere.
      const watched = insideProjects(event, root, projects, 'the Project root')
      const subscriber = subscriberOf(clientOf(event), root)
      opened.remember(subscriber.id, root, watched)
      return { ...(await options.hub.open(watched, subscriber)), root }
    }),
    defineHandler(workflowClose, async ({ root }, { event }) => {
      const client = clientOf(event)
      return { closed: client === undefined ? false : await options.hub.close(opened.take(client.id, root), client.id) }
    }),
  ]
}

/**
 * The root each client's open gave the hub, by the client's id and the root as it sent it, so its
 * close lets go of the same subscription. A close is not checked against the Projects: it only lets
 * the caller's own subscriber go and reads nothing, and a refusal would leave the watch running
 * until the client is gone — after the root left the Projects, say.
 */
export class OpenedRoots {
  private readonly byClient = new Map<ClientId, Map<string, string>>()

  remember(id: ClientId, asSent: string, opened: string): void {
    const roots = this.byClient.get(id) ?? new Map<string, string>()
    this.byClient.set(id, roots.set(asSent, opened))
  }

  /** The root the open of `asSent` gave the hub, forgotten now; path.resolve of it when there was no open. */
  take(id: ClientId, asSent: string): string {
    const roots = this.byClient.get(id)
    const opened = roots?.get(asSent)
    if (roots === undefined || opened === undefined) return resolve(asSent)
    roots.delete(asSent)
    if (roots.size === 0) this.byClient.delete(id)
    return opened
  }

  /** Forgets every root of a client that is gone. */
  forget(id: ClientId): void {
    this.byClient.delete(id)
  }

  /** How many roots are remembered; for tests. */
  get size(): number {
    let count = 0
    for (const roots of this.byClient.values()) count += roots.size
    return count
  }
}

export default workflowHandlers({ hub: workflowHub })
