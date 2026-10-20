// Handlers of the `memory` domain (src/shared/ipc/memory.ts). A client (src/main/clients.ts) that
// opens the figure gets every new sample on `memory.changed` until it closes it or is destroyed;
// while no client has it open, the sampler stops (src/main/diagnostics/memory.ts).
import { appMemory, type MemorySampler } from '../diagnostics/memory'
import { clientOf, type Client } from '../clients'
import { memoryChanged, memoryClose, memoryOpen } from '../../shared/ipc/memory'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a sampler; tests pass their own. */
export function memoryHandlers(sampler: () => MemorySampler): HandlerModule {
  /** The removal of each open client's listener. */
  const open = new Map<Client, () => void>()
  /** The clients whose `destroyed` is listened to: once per client, however often it opens. */
  const held = new WeakSet<Client>()

  const close = (client: Client): void => {
    const unsubscribe = open.get(client)
    if (unsubscribe === undefined) return
    open.delete(client)
    unsubscribe()
  }

  return [
    defineHandler(memoryOpen, (_input, { event }) => {
      const client = clientOf(event)
      if (client !== undefined && !open.has(client) && !client.isDestroyed()) {
        if (!held.has(client)) {
          held.add(client)
          client.once('destroyed', () => close(client))
        }
        open.set(
          client,
          sampler().subscribe((usage) => {
            if (!client.isDestroyed()) emit(client, memoryChanged, usage)
          }),
        )
      }
      return sampler().snapshot()
    }),
    defineHandler(memoryClose, (_input, { event }) => {
      const client = clientOf(event)
      if (client !== undefined) close(client)
    }),
  ]
}

export default memoryHandlers(appMemory) satisfies HandlerModule
