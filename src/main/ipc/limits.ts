// Handlers of the `limits` domain (src/shared/ipc/limits.ts). A client (src/main/clients.ts) that
// opens the Limits gets every later change on `limits.changed` until it is destroyed.
import { appLimits, type LimitsTracker } from '../agent/limits'
import { clientOf, type Client } from '../clients'
import { limitsChanged, limitsOpen } from '../../shared/ipc/limits'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a tracker; tests pass their own. */
export function limitsHandlers(tracker: () => LimitsTracker): HandlerModule {
  const subscribed = new WeakSet<Client>()
  return [
    defineHandler(limitsOpen, (_input, { event }) => {
      const client = clientOf(event)
      if (client !== undefined && !subscribed.has(client) && !client.isDestroyed()) {
        subscribed.add(client)
        const unsubscribe = tracker().subscribe((state) => {
          if (!client.isDestroyed()) emit(client, limitsChanged, state)
        })
        client.once('destroyed', () => {
          unsubscribe()
          subscribed.delete(client)
        })
      }
      return tracker().snapshot()
    }),
  ]
}

export default limitsHandlers(appLimits) satisfies HandlerModule
