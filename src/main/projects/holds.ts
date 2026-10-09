// The Projects of this Machine that screens of Linked machines show (worfy-link ticket 09,
// `projects.hold`). This Machine does for each of them what it does for its own active Project:
// its Orchestrator is opened (src/main/agent/app-orchestrators.ts) and its documents are kept
// open for the HANDOFF Node (src/main/ipc/docs.ts). The active Project itself does not change:
// this Machine's own screens stay on theirs.
//
// A hold belongs to a client of main (the connection of a Linked machine, src/main/clients.ts)
// and one of its screens. A client that leaves — its connection closed, access switched off — lets
// go of every Project it held.
//
// Nothing here reaches Electron: the contract tests use it as it is.
import { ClientHolders, type Client, type ClientId } from '../clients'

export class ProjectHolds {
  /** Client id → screen → the Project it shows. */
  private readonly byClient = new Map<ClientId, Map<string, string>>()
  private readonly holders = new ClientHolders((id) => {
    if (this.byClient.delete(id)) this.changed()
  })
  private readonly listeners = new Set<() => void>()

  /**
   * Screen `screen` of `client` shows `projectId` now; null — none. False for a client already
   * gone: it holds nothing.
   */
  set(client: Pick<Client, 'id' | 'once' | 'isDestroyed'>, screen: string, projectId: string | null): boolean {
    if (projectId === null) {
      const screens = this.byClient.get(client.id)
      if (screens?.delete(screen) !== true) return true
      if (screens.size === 0) this.byClient.delete(client.id)
      this.changed()
      return true
    }
    if (!this.holders.hold(client)) return false
    let screens = this.byClient.get(client.id)
    if (screens === undefined) {
      screens = new Map()
      this.byClient.set(client.id, screens)
    }
    if (screens.get(screen) === projectId) return true
    screens.set(screen, projectId)
    this.changed()
    return true
  }

  /** The Projects some screen shows now. */
  projectIds(): Set<string> {
    const ids = new Set<string>()
    for (const screens of this.byClient.values()) for (const projectId of screens.values()) ids.add(projectId)
    return ids
  }

  /** Calls `listener` after every change; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[projects] a listener of the held Projects failed', error)
      }
    }
  }
}

let shared: ProjectHolds | undefined

/** The app's holds, made on first use. */
export function projectHolds(): ProjectHolds {
  shared ??= new ProjectHolds()
  return shared
}
