// The offer of the team reviewer after a Project is added (worfy-human-review ticket 09, spec Q7 (a)):
// one `action` toast of the Project (toast/toasts.ts) "Build a reviewer in your team's style?" with
// "Build" and "Later". It stays until it is answered and shows while its Project is active.
// - "Build": a new Session Node in the Project's root with /worfy:human-review-setup, on Claude Code
//   (projects.reviewer.build).
// - "Later", or the toast closed: `humanReview.offer: "later"` in the Project's settings
//   (projects.reviewer.later), and the offer is never made again; "Build" stays in Project settings.
// Main decides when to offer (src/main/projects/review-offer.ts) and tells the windows with
// `projects.reviewer.offer`. An answer from another window (projects.settings.changed with the
// offer answered) closes the toast here too. A window with read-only access to the Project's Machine
// shows no offer: both buttons write.
import type { ProjectSettings } from '../../shared/projects/action-templates'
import { invoke, showSubscribeError, subscribe } from '../ipc'
import { dismissToast, showToast, toasts } from '../toast/toasts'
import { readOnlyNow } from './read-only-now'

export const REVIEW_OFFER_TEXT = "Build a reviewer in your team's style?"

/** `data-testid` of the toast. */
export const REVIEW_OFFER_TEST_ID = 'review-offer-toast'

/** The toast's key: one per Project. */
export const reviewOfferKey = (projectId: string): string => `review-offer:${projectId}`

/** Records "Later": the offer is not made again for the Project. */
function later(projectId: string): void {
  void invoke('projects.reviewer.later', { id: projectId }).then((result) => {
    if (!result.ok) console.error('projects.reviewer.later failed:', result.error)
  })
}

/** Starts the generator's Session; a failure is told in a toast of its own. */
function build(projectId: string): void {
  void invoke('projects.reviewer.build', { id: projectId }).then((result) => {
    if (!result.ok) showToast({ kind: 'error', key: `${reviewOfferKey(projectId)}:error`, projectId, text: `Build the team reviewer: ${result.error}` })
  })
}

/** The Projects whose offer this window saw answered elsewhere: its toast closes without a second write. */
const answeredElsewhere = new Set<string>()

/** Shows the offer of Project `projectId`; however it leaves without "Build", the Project's answer is "Later". */
export function showReviewOffer(projectId: string): void {
  const key = reviewOfferKey(projectId)
  if (readOnlyNow() !== null || toasts.getState().toasts.some((toast) => toast.id === key)) return
  answeredElsewhere.delete(projectId)
  let built = false
  const stop = toasts.subscribe((state) => {
    if (state.toasts.some((toast) => toast.id === key)) return
    stop()
    if (!built && !answeredElsewhere.has(projectId)) later(projectId)
  })
  showToast({
    kind: 'action',
    key,
    projectId,
    testId: REVIEW_OFFER_TEST_ID,
    text: REVIEW_OFFER_TEXT,
    actions: [
      {
        label: 'Build',
        run: () => {
          built = true
          build(projectId)
        },
      },
      // The toast leaves after the button: the subscription above records the answer.
      { label: 'Later', run: () => undefined },
    ],
  })
}

/** Settings saved with the offer answered close the offer's toast (another window answered it). */
export function acceptSettings({ id, settings }: { id: string; settings: Pick<ProjectSettings, 'humanReview'> }): void {
  if (settings.humanReview?.offer !== 'later') return
  answeredElsewhere.add(id)
  dismissToast(reviewOfferKey(id))
}

/** Subscribes the window to the offers of main; returns the unsubscribe. */
export function installReviewOffers(): () => void {
  const stops: (() => void)[] = []
  try {
    stops.push(subscribe('projects.reviewer.offer', ({ projectId }) => showReviewOffer(projectId)))
    stops.push(subscribe('projects.settings.changed', acceptSettings))
  } catch (error) {
    showSubscribeError('projects.reviewer.offer', error)
  }
  return () => {
    for (const stop of stops) stop()
  }
}
