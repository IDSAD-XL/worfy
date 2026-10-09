// The `notify` domain's calls (ticket 21): the client a notification click opened asks for the
// Session it should show (src/main/notify-pending.ts). The note names the Linked machine whose
// Session it is when it is not this Machine's (worfy-link ticket 13).
import { notifyPending } from '../../shared/ipc/notify'
import { clientOf } from '../clients'
import { pendingOpens, type PendingOpens } from '../notify-pending'
import { defineHandler, type HandlerModule } from './index'

export function notifyHandlers(pending: PendingOpens = pendingOpens): HandlerModule {
  return [
    defineHandler(notifyPending, (_input, { event }) => {
      const client = clientOf(event)
      return { note: client === undefined ? null : pending.take(client.id) }
    }),
  ]
}

export default notifyHandlers() satisfies HandlerModule
