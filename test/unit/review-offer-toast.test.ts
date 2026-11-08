// The toast of the team reviewer offer (worfy-human-review ticket 09, src/renderer/projects/review-offer.ts):
// "Build" starts the generator's Session, "Later" and closing the toast record the answer, and an answer
// from another window closes it here without a second write. main is replaced: the calls are recorded.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const main = vi.hoisted(() => ({
  calls: [] as { channel: string; input: unknown }[],
  answers: {} as Record<string, { ok: true; value: unknown } | { ok: false; error: string }>,
}))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: (channel: string, input?: unknown) => {
    main.calls.push({ channel, input })
    return Promise.resolve(main.answers[channel] ?? { ok: true, value: {} })
  },
  subscribe: () => () => undefined,
  showSubscribeError: () => undefined,
}))

const { acceptSettings, REVIEW_OFFER_TEXT, REVIEW_OFFER_TEST_ID, reviewOfferKey, showReviewOffer } = await import('../../src/renderer/projects/review-offer')
const { dismissToast, pressToastAction, resetToasts, setToastProject, shownToasts, toasts } = await import('../../src/renderer/toast/toasts')

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))
const channels = (): string[] => main.calls.map((call) => call.channel)

beforeEach(() => {
  resetToasts()
  main.calls.length = 0
  main.answers = {}
})

describe('the team reviewer offer toast', () => {
  it('is an action toast of its Project with "Build" and "Later", shown only while that Project is active', () => {
    showReviewOffer('shop-1')
    const [toast] = toasts.getState().toasts
    expect(toast).toMatchObject({ kind: 'action', key: reviewOfferKey('shop-1'), projectId: 'shop-1', testId: REVIEW_OFFER_TEST_ID, text: "Build a reviewer in your team's style?" })
    expect(REVIEW_OFFER_TEXT).toBe("Build a reviewer in your team's style?")
    expect(toast?.actions?.map((action) => action.label)).toEqual(['Build', 'Later'])
    setToastProject('other-2')
    expect(shownToasts(toasts.getState())).toEqual([])
    setToastProject('shop-1')
    expect(shownToasts(toasts.getState())).toHaveLength(1)
  })

  it('"Later" records the answer once', async () => {
    showReviewOffer('shop-1')
    pressToastAction(reviewOfferKey('shop-1'), 1)
    await settle()
    expect(main.calls).toEqual([{ channel: 'projects.reviewer.later', input: { id: 'shop-1' } }])
  })

  it('closing the toast records "Later" too', async () => {
    showReviewOffer('shop-1')
    dismissToast(reviewOfferKey('shop-1'))
    await settle()
    expect(channels()).toEqual(['projects.reviewer.later'])
  })

  it('"Build" starts the Session and records no answer; a refusal comes as an error toast of the Project', async () => {
    showReviewOffer('shop-1')
    pressToastAction(reviewOfferKey('shop-1'), 0)
    await settle()
    expect(main.calls).toEqual([{ channel: 'projects.reviewer.build', input: { id: 'shop-1' } }])

    main.calls.length = 0
    main.answers['projects.reviewer.build'] = { ok: false, error: 'no Session' }
    showReviewOffer('shop-1')
    pressToastAction(reviewOfferKey('shop-1'), 0)
    await settle()
    expect(channels()).toEqual(['projects.reviewer.build'])
    expect(toasts.getState().toasts).toMatchObject([{ kind: 'error', projectId: 'shop-1', text: 'Build the team reviewer: no Session' }])
  })

  it('an answer saved by another window closes the toast without a second write; other settings leave it', async () => {
    showReviewOffer('shop-1')
    acceptSettings({ id: 'shop-1', settings: {} })
    expect(toasts.getState().toasts).toHaveLength(1)
    acceptSettings({ id: 'shop-1', settings: { humanReview: { offer: 'later' } } })
    await settle()
    expect(toasts.getState().toasts).toEqual([])
    expect(main.calls).toEqual([])
  })

  it('a second offer of the same Project while its toast is up adds no second toast', () => {
    showReviewOffer('shop-1')
    showReviewOffer('shop-1')
    expect(toasts.getState().toasts).toHaveLength(1)
  })
})

describe('the team reviewer offer on a read-only screen', () => {
  it('shows no toast: both buttons write', async () => {
    const { answerReadOnly } = await import('../../src/renderer/projects/read-only-now')
    answerReadOnly(() => 'Mini gives this Machine read-only access')
    try {
      showReviewOffer('shop-1')
      expect(toasts.getState().toasts).toEqual([])
    } finally {
      answerReadOnly(() => null)
    }
  })
})
