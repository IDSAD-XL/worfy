// Handlers of the `memory` domain (src/shared/ipc/memory.ts). A client (src/main/clients.ts) that
// opens the figure gets every new sample on `memory.changed` until it closes it as many times as it
// opened it, or is destroyed; while no client has it open, the sampler stops
// (src/main/diagnostics/memory.ts).
import { appMemory, type MemorySampler } from '../diagnostics/memory'
import { clientOf, type Client } from '../clients'
import { memoryChanged, memoryClose, memoryOpen } from '../../shared/ipc/memory'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a sampler; tests pass their own. */
export function memoryHandlers(sampler: () => MemorySampler): HandlerModule {
  /**
   * Each open client: how many of its views have the figure open, and the removal of its one
   * listener. A window may show the figure in more than one place; it stays subscribed until the
   * last of them closes it, so one view closing never stops the figure of another.
   */
  const open = new Map<Client, { views: number; unsubscribe: () => void }>()
  /** The clients whose `destroyed` is listened to: once per client, however often it opens. */
  const held = new WeakSet<Client>()

  /** Ends the client's subscription, whatever its count. */
  const drop = (client: Client): void => {
    const entry = open.get(client)
    if (entry === undefined) return
    open.delete(client)
    entry.unsubscribe()
  }

  return [
    defineHandler(memoryOpen, (_input, { event }) => {
      const client = clientOf(event)
      if (client !== undefined && !client.isDestroyed()) {
        const entry = open.get(client)
        if (entry !== undefined) entry.views += 1
        else {
          if (!held.has(client)) {
            held.add(client)
            client.once('destroyed', () => drop(client))
          }
          open.set(client, {
            views: 1,
            unsubscribe: sampler().subscribe((usage) => {
              if (!client.isDestroyed()) emit(client, memoryChanged, usage)
            }),
          })
        }
      }
      return sampler().snapshot()
    }),
    defineHandler(memoryClose, (_input, { event }) => {
      const client = clientOf(event)
      const entry = client === undefined ? undefined : open.get(client)
      if (client === undefined || entry === undefined) return
      entry.views -= 1
      if (entry.views <= 0) drop(client)
    }),
  ]
}

export default memoryHandlers(appMemory) satisfies HandlerModule
