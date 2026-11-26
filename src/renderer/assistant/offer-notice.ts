// The one message that offers the Assistant to a person who updated worfy (worfy-assistant ticket 16; owner's decision 10;
// story 30), as the notice of Getting started does for it (src/renderer/getting-started/notice.ts, worfy-onboarding
// ticket 08): one `action` toast with «Meet Assistant» and «Not now», never a modal window, and nothing forced. «Not
// now» refuses the offer for good. «Meet Assistant» shows the Assistant's section, where the offer stands with what the
// Assistant does and «Turn on and meet». Left any other way — Dismiss, Escape — main hears that it was shown, so no later
// window or start shows it again, and the offer stays in the section.
//
// Only for an existing user, as Getting started decided once (its `user`): a new one is offered the Assistant on the
// welcome step of First run. Only while the view says the message is owed (`offer.notice`), which main never says under
// WORFY_GETTING_STARTED_AUTO=0 (the e2e runs), and never in a window of a Linked machine: the Assistant is this Machine's.
import type { AssistantView } from '../../shared/assistant/window'
import { invoke, windowMachine } from '../ipc'
import { showToast, toasts } from '../toast/toasts'
import { answerOffer, revealAssistant, useAssistant } from './useAssistant'

export const OFFER_NOTICE_KEY = 'assistant-offer-notice'
export const OFFER_NOTICE_TEXT = 'New: Assistant, worfy’s own agent, tells you what waits across your Projects and why. It is off until you turn it on.'

/** Calls `then` with the Assistant's view once the window has it. */
function whenView(then: (view: AssistantView) => void): void {
  const now = useAssistant.getState().view
  if (now !== null) return then(now)
  const stop = useAssistant.subscribe((state) => {
    if (state.view === null) return
    stop()
    then(state.view)
  })
}

/** Shows the message; however it leaves without «Not now», main hears that it was shown. */
function showNotice(): void {
  let declined = false
  const stop = toasts.subscribe((state) => {
    if (state.toasts.some((toast) => toast.id === OFFER_NOTICE_KEY)) return
    stop()
    if (!declined) void answerOffer('seen')
  })
  showToast({
    kind: 'action',
    key: OFFER_NOTICE_KEY,
    testId: OFFER_NOTICE_KEY,
    text: OFFER_NOTICE_TEXT,
    actions: [
      { label: 'Meet Assistant', run: () => revealAssistant() },
      {
        label: 'Not now',
        run: () => {
          declined = true
          void answerOffer('declined')
        },
      },
    ],
  })
}

let installed = false

/** Reads once per window load whether the message is owed to this person, and shows it then. */
export function installAssistantOffer(): void {
  if (installed || windowMachine() !== null) return
  installed = true
  void invoke('gettingStarted.state').then((result) => {
    if (!result.ok) return console.error('gettingStarted.state failed:', result.error)
    if (result.value.user !== 'existing') return
    whenView((view) => {
      if (view.offer.notice) showNotice()
    })
  })
}
