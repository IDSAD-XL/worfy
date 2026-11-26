// Handlers of the `assistant` domain (src/shared/ipc/assistant.ts; worfy-assistant ticket 14). A client (src/main/clients.ts)
// that opens the view gets the whole view again on `assistant.changed` after every change, until it is destroyed. Each
// click is the section's own function in main (src/main/assistant/window/view.ts), which refuses, with the reason, an
// item or a message that is no longer there.
import {
  assistantChanged,
  assistantDismissProposal,
  assistantForgetRule,
  assistantItem,
  assistantOpen,
  assistantRate,
  assistantSend,
  assistantSnooze,
  assistantStart,
} from '../../shared/ipc/assistant'
import { appAssistantWindow, takeReveal } from '../assistant/window/app'
import type { AssistantWindow } from '../assistant/window/view'
import { clientOf, type Client } from '../clients'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a section; tests pass their own, with `reveal` answering whether a clicked notification waits. */
export function assistantHandlers(section: () => AssistantWindow, reveal: () => boolean = takeReveal): HandlerModule {
  const subscribed = new WeakSet<Client>()
  return [
    defineHandler(assistantOpen, (_input, { event }) => {
      const client = clientOf(event)
      if (client !== undefined && !subscribed.has(client) && !client.isDestroyed()) {
        subscribed.add(client)
        const unsubscribe = section().subscribe(() => {
          if (!client.isDestroyed()) emit(client, assistantChanged, section().view())
        })
        client.once('destroyed', () => {
          unsubscribe()
          subscribed.delete(client)
        })
      }
      return { view: section().view(), reveal: reveal() }
    }),
    defineHandler(assistantItem, ({ itemId, op }) => {
      section().item(itemId, op)
      return {}
    }),
    defineHandler(assistantSnooze, ({ itemId, choice }) => ({ until: section().snooze(itemId, choice) })),
    defineHandler(assistantRate, ({ target, rating }) => ({ rule: section().rate(target, rating) })),
    defineHandler(assistantForgetRule, ({ ruleId }) => {
      section().forgetRule(ruleId)
      return {}
    }),
    defineHandler(assistantDismissProposal, ({ proposalId }) => {
      section().dismissProposal(proposalId)
      return {}
    }),
    defineHandler(assistantStart, (request) => section().start(request)),
    defineHandler(assistantSend, ({ text }) => {
      section().send(text)
      return {}
    }),
  ]
}

export default assistantHandlers(appAssistantWindow) satisfies HandlerModule
