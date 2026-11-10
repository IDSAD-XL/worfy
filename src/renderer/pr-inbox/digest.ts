// The morning digest of the PR inbox in the window (worfy-pr-inbox ticket 07): when the window gets the focus, it asks
// main with `prInbox.digest` (src/main/github/inbox-digest.ts), which answers the digest the first time in a day. The
// answer shows as one action toast (toast/toasts.ts) with the button Open: the Pull requests view of the active
// Project when the digest counts it, else of the first Project it counts (openPrInboxOf). `pending` — an inbox is not
// read yet — asks again at each `prInbox.changed` until main answers otherwise. A window on a Linked machine asks
// nothing: the digest tells of this Machine's Projects.
import type { PrInboxDigestAnswer } from '../../shared/ipc/pr-inbox'
import { invoke, showSubscribeError, subscribe, windowMachine } from '../ipc'
import { followActiveProject } from '../projects/useProjects'
import { showToast } from '../toast/toasts'
import { openPrInboxOf } from './open'

export const DIGEST_TOAST_KEY = 'pr-inbox-digest'

/** Shows the digest of `answer`, if it has one, in an action toast whose Open opens the Pull requests view. */
export function showDigest(answer: PrInboxDigestAnswer, activeId: () => string | undefined): void {
  if (answer.state !== 'show') return
  const open = (): void => {
    const active = activeId()
    const target = active !== undefined && answer.projectIds.includes(active) ? active : answer.projectIds[0]
    if (target === undefined) return
    void openPrInboxOf(target, active).then((problem) => {
      if (problem !== undefined) showToast({ kind: 'error', key: `${DIGEST_TOAST_KEY}:error`, text: `The Pull requests view did not open: ${problem}` })
    })
  }
  showToast({ kind: 'action', key: DIGEST_TOAST_KEY, testId: 'pr-inbox-digest', text: answer.text, actions: [{ label: 'Open', run: open }] })
}

/** Asks for the digest at each focus of the window; answers the function that stops it. */
export function installPrInboxDigest(): () => void {
  if (windowMachine() !== null) return () => undefined
  let active: string | undefined
  let waiting = false
  let asking = false
  const stopActive = followActiveProject((projectId) => {
    active = projectId
  })
  const ask = (): void => {
    if (asking) return
    asking = true
    void invoke('prInbox.digest')
      .then((result) => {
        if (!result.ok) {
          console.error('prInbox.digest failed:', result.error)
          return
        }
        waiting = result.value.state === 'pending'
        showDigest(result.value, () => active)
      })
      .finally(() => {
        asking = false
      })
  }
  let stopChanged: () => void = () => undefined
  try {
    stopChanged = subscribe('prInbox.changed', () => {
      if (waiting) ask()
    })
  } catch (error) {
    showSubscribeError('prInbox.changed', error)
  }
  window.addEventListener('focus', ask)
  if (document.hasFocus()) ask()
  return () => {
    window.removeEventListener('focus', ask)
    stopChanged()
    stopActive()
  }
}
