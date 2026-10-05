// The `notify` domain's calls (ticket 21): the window a notification click opened asks for the
// Session it should show (src/main/notify-pending.ts).
import { notifyPending } from '../../shared/ipc/notify'
import { pendingOpens, type PendingOpens } from '../notify-pending'
import { defineHandler, type HandlerModule } from './index'

export function notifyHandlers(pending: PendingOpens = pendingOpens): HandlerModule {
  return [defineHandler(notifyPending, (_input, { event }) => ({ note: pending.take(event.sender.id) }))]
}

export default notifyHandlers() satisfies HandlerModule
