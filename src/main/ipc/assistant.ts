// Handlers of the `assistant` domain (src/shared/ipc/assistant.ts; worfy-assistant ticket 14). A client (src/main/clients.ts)
// that opens the view gets the whole view again on `assistant.changed` after every change, until it is destroyed. Each
// click is the section's own function in main (src/main/assistant/window/view.ts), which refuses, with the reason, an
// item or a message that is no longer there. A window that opens the view follows the section: a clicked notification
// reveals the section in it (AssistantReveal). Settings → Assistant (ticket 15) reads its view and changes the duties
// and the checks through AssistantSettingsPanel (src/main/assistant/settings/app.ts); Apply under a card «before → after»
// is the section's own function. `assistant.waiting` is the one channel a Linked machine reaches (worfy-assistant
// ticket 18): it reads what waits here, and the link adapter answers it by the caller's access level.
import {
  assistantApply,
  assistantChanged,
  assistantCheckNow,
  assistantConfigureDuty,
  assistantDismissProposal,
  assistantForgetRule,
  assistantItem,
  assistantOpen,
  assistantPauseAfter,
  assistantRate,
  assistantResumeDuty,
  assistantSend,
  assistantSettings,
  assistantShown,
  assistantSnooze,
  assistantStart,
  assistantWaiting,
} from '../../shared/ipc/assistant'
import { appAssistantSettings, type AssistantSettingsPanel } from '../assistant/settings/app'
import { appAssistantReveal, appAssistantWindow } from '../assistant/window/app'
import type { AssistantReveal } from '../assistant/window/reveal'
import type { AssistantWindow } from '../assistant/window/view'
import { clientOf, type Client } from '../clients'
import { defineHandler, emit, type HandlerModule } from './index'

/** The handlers over a section; tests pass their own, their own reveal of a clicked notification and their own Settings → Assistant. */
export function assistantHandlers(section: () => AssistantWindow, reveal: () => AssistantReveal<Client> = appAssistantReveal, settings: () => AssistantSettingsPanel = appAssistantSettings): HandlerModule {
  const subscribed = new WeakSet<Client>()
  return [
    defineHandler(assistantOpen, (_input, { event }) => {
      const client = clientOf(event)
      if (client !== undefined && !subscribed.has(client) && !client.isDestroyed()) {
        subscribed.add(client)
        const unsubscribe = section().subscribe(() => {
          if (!client.isDestroyed()) emit(client, assistantChanged, section().view())
        })
        const unfollow = reveal().follow(client)
        client.once('destroyed', () => {
          unsubscribe()
          unfollow()
          subscribed.delete(client)
        })
      }
      return { view: section().view(), reveal: reveal().take() }
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
    defineHandler(assistantShown, ({ itemIds }) => {
      section().shown(itemIds)
      return {}
    }),
    defineHandler(assistantSend, ({ text }) => {
      section().send(text)
      return {}
    }),
    defineHandler(assistantWaiting, () => section().waiting()),
    defineHandler(assistantApply, ({ proposalId }) => {
      section().apply(proposalId)
      return {}
    }),
    defineHandler(assistantSettings, () => settings().view()),
    defineHandler(assistantConfigureDuty, ({ dutyId, ...choice }) => {
      settings().configureDuty(dutyId, choice)
      return {}
    }),
    defineHandler(assistantResumeDuty, ({ dutyId }) => {
      settings().resumeDuty(dutyId)
      return {}
    }),
    defineHandler(assistantPauseAfter, ({ count }) => {
      settings().setPauseAfter(count)
      return {}
    }),
    defineHandler(assistantCheckNow, ({ kind }) => ({ started: settings().checkNow(kind) })),
  ]
}

export default assistantHandlers(appAssistantWindow) satisfies HandlerModule
