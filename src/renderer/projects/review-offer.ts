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
//
// The reminder to update the reviewer (worfy-human-review ticket 10, spec Q8 (a)): when a Project
// becomes active the window asks main (projects.reviewer.remind), which answers `due` once in 30 days
// for a reviewer built more than 30 days ago. A due one is an `action` toast of the Project "Update your
// team reviewer?" with "Update" and "Later". "Update" starts the generator with --refresh
// (projects.reviewer.build with `refresh`); "Later" or closing only closes it: main recorded the
// reminder already, and the next one comes in 30 days. Nothing here reads the history or spends tokens.
// A read-only window does not ask: main records the reminder it answers.
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

/** Starts the generator's Session (with `refresh`, its update); a failure is told in a toast of its own. */
function build(projectId: string, refresh = false): void {
  void invoke('projects.reviewer.build', refresh ? { id: projectId, refresh } : { id: projectId }).then((result) => {
    if (!result.ok)
      showToast({
        kind: 'error',
        key: `${refresh ? reviewRefreshKey(projectId) : reviewOfferKey(projectId)}:error`,
        projectId,
        text: `${refresh ? 'Update' : 'Build'} the team reviewer: ${result.error}`,
      })
  })
}

export const REVIEW_REFRESH_TEXT = 'Update your team reviewer?'

/** `data-testid` of the reminder's toast. */
export const REVIEW_REFRESH_TEST_ID = 'review-refresh-toast'

/** The reminder's key: one per Project. */
export const reviewRefreshKey = (projectId: string): string => `review-refresh:${projectId}`

/** Shows the reminder of Project `projectId`: "Update" starts the generator with --refresh, "Later" closes it. */
export function showReviewRefresh(projectId: string): void {
  showToast({
    kind: 'action',
    key: reviewRefreshKey(projectId),
    projectId,
    testId: REVIEW_REFRESH_TEST_ID,
    text: REVIEW_REFRESH_TEXT,
    actions: [
      { label: 'Update', run: () => build(projectId, true) },
      { label: 'Later', run: () => undefined },
    ],
  })
}

/** Project `projectId` became active: asks main whether the reminder is due, and shows it when it is. */
export async function remindReviewRefresh(projectId: string): Promise<void> {
  if (readOnlyNow() !== null) return
  const result = await invoke('projects.reviewer.remind', { id: projectId })
  if (!result.ok) console.error('projects.reviewer.remind failed:', result.error)
  else if (result.value.due) showReviewRefresh(projectId)
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

/**
 * Subscribes the window to the offers of main and, through `followActive` (followActiveProject of
 * useProjects.ts), asks for the reminder whenever a Project becomes active; returns the unsubscribe.
 */
export function installReviewOffers(followActive?: (listener: (projectId: string) => void) => () => void): () => void {
  const stops: (() => void)[] = []
  if (followActive) stops.push(followActive((projectId) => void remindReviewRefresh(projectId)))
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
