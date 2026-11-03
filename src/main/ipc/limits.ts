// Handlers of the `limits` domain (src/shared/ipc/limits.ts). A client (src/main/clients.ts) that
// opens the Limits gets the whole view again on `limits.changed` after every change, of Claude's state
// or of another Vendor's windows, until it is destroyed.
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
        const send = (): void => {
          if (!client.isDestroyed()) emit(client, limitsChanged, tracker().view())
        }
        const unsubscribe = [tracker().subscribe(send), tracker().subscribeWindows(send)]
        client.once('destroyed', () => {
          for (const each of unsubscribe) each()
          subscribed.delete(client)
        })
      }
      return tracker().view()
    }),
  ]
}

export default limitsHandlers(appLimits) satisfies HandlerModule
