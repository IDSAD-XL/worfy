// The notice in the corner for an existing user (worfy-onboarding ticket 08; the epic's spec,
// decision 7, and the owner's point 3): one `action` toast (toast/toasts.ts) "New: Getting started —
// a guided demo of worfy." with "Open" and "Not now", never a modal window. "Open" shows the
// section (openGettingStarted). However it leaves — either button, or closed (Escape) — main hears
// `gettingStarted.noticeSeen` and records it, so no later window or start shows it again. A new user
// gets none: the section shows by itself for them. With WORFY_GETTING_STARTED_AUTO=0 (the e2e tests)
// main reads the notice as shown already (src/main/getting-started/state.ts).
import type { GettingStartedSnapshot } from '../../shared/ipc/getting-started'
import { invoke } from '../ipc'
import { showToast, toasts } from '../toast/toasts'
import { openGettingStarted } from './store'

export const NOTICE_KEY = 'getting-started-notice'
export const NOTICE_TEXT = 'New: Getting started — a guided demo of worfy.'

/** Whether this state owes the notice: an existing user who has not seen it. */
export const owesNotice = (state: GettingStartedSnapshot): boolean => state.user === 'existing' && !state.noticeShown

/** Shows the notice and tells main once it has left the store of toasts, whichever way it left. */
function showNotice(): void {
  const stop = toasts.subscribe((state) => {
    if (state.toasts.some((toast) => toast.id === NOTICE_KEY)) return
    stop()
    void invoke('gettingStarted.noticeSeen').then((result) => {
      if (!result.ok) console.error('gettingStarted.noticeSeen failed:', result.error)
    })
  })
  const open = (): void => {
    void openGettingStarted().then((failure) => {
      if (failure !== undefined) showToast({ kind: 'error', key: `${NOTICE_KEY}:error`, text: failure })
    })
  }
  showToast({
    kind: 'action',
    key: NOTICE_KEY,
    testId: NOTICE_KEY,
    text: NOTICE_TEXT,
    actions: [
      { label: 'Open', run: open },
      { label: 'Not now', run: () => undefined },
    ],
  })
}

let installed = false

/**
 * Reads the state once per window load and shows the notice when it is owed.
 * shortcut: two windows open together both show it until one is closed, redo if the owner sees it twice.
 */
export function installGettingStartedNotice(): void {
  if (installed) return
  installed = true
  void invoke('gettingStarted.state').then((result) => {
    if (!result.ok) console.error('gettingStarted.state failed:', result.error)
    else if (owesNotice(result.value)) showNotice()
  })
}
