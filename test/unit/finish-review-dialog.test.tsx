// The Finish review dialog (worfy-pr-review ticket 11; src/renderer/pr-review/FinishReviewDialog.tsx) over a fake
// preload bridge that answers `prReview.check` and `prReview.submit` in the shape main sends them:
// - the verdict starts on Comment, whatever the agent suggested; «The agent suggests: …» beside it;
// - Approve and Request changes inactive on the person's own PR; Comment and Request changes inactive without a summary
//   and without comments;
// - every comment as it goes: `path:line`, its text, «by the agent» on the agent's; Remove keeps it out of the POST;
//   a comment not on a changed line keeps Submit inactive until it is removed;
// - the texts it opened with: a draft that changes meanwhile does not change what goes;
// - the head moved: «Your comments are on <a>; the head is <b>.» and Submit on <a>; a head that moved while it was open
//   comes back from main and is shown;
// - Enter does not submit, a click or ⌘↵ does — once;
// - the line of review-draft-lint: checked, or its findings, which keep Submit inactive.
// Every repository, login, sha and text is invented. Nothing here reaches GitHub.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import { ms } from '../time-scale'
import { UNCONFIRMED, type PrReviewSubmitAnswer, type ReviewComment, type ReviewDraft } from '../../src/shared/ipc/pr-review'

const PROJECT = 'web-00000001'
const REPO = 'example-org/web'
const NUMBER = 77
const START = '3f2a9c1e5b7d4a6c8e0f1a2b3c4d5e6f7a8b9c0d'
const MOVED = '7d0e4b2c1a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d'

const on = (line: number, body: string, over: Partial<ReviewComment> = {}): ReviewComment => ({ path: 'src/net/retry.ts', line, side: 'RIGHT', body, ...over })
const draftOf = (comments: { comment: ReviewComment; by: 'person' | 'agent' }[], over: Partial<ReviewDraft> = {}): ReviewDraft => ({
  schema: 1,
  repo: REPO,
  pr: NUMBER,
  startedOn: START,
  payload: { body: '', comments: comments.map((each) => each.comment) },
  anchors: comments.map((each) => ({ text: 'x', by: each.by })),
  viewed: {},
  state: 'draft',
  ...over,
})

interface Fake {
  calls: { channel: string; input: Record<string, unknown> }[]
}
let main: Fake

function preload(answers: { check?: (input: Record<string, unknown>) => { findings: string[]; reason: string | null }; submit?: (input: Record<string, unknown>) => PrReviewSubmitAnswer } = {}): void {
  const fake: Fake = { calls: [] }
  const answer = (channel: string, input: Record<string, unknown>): IpcResult<unknown> => {
    if (channel === 'prReview.check') return { ok: true, value: answers.check?.(input) ?? { findings: [], reason: null } }
    if (channel === 'prReview.submit') return { ok: true, value: answers.submit?.(input) ?? { outcome: 'submitted', reason: null, reviewUrl: `https://github.com/${REPO}/pull/${NUMBER}#pullrequestreview-1`, head: null, draft: null } }
    return { ok: true, value: null }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input: input as Record<string, unknown> })
      return Promise.resolve(answer(channel, input as Record<string, unknown>) as never)
    },
    on: () => 0,
    off: () => undefined,
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

const calls = (channel: string): Record<string, unknown>[] => main.calls.filter((call) => call.channel === channel).map((call) => call.input)

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 20))
  })

async function mount(draft: ReviewDraft, over: { head?: string; mine?: boolean; off?: number[] } = {}) {
  const { FinishReviewDialog } = await import('../../src/renderer/pr-review/FinishReviewDialog')
  const onSubmitted = vi.fn()
  const onClose = vi.fn()
  const props = { projectId: PROJECT, repo: REPO, number: NUMBER, head: over.head ?? START, mine: over.mine ?? false, off: new Set(over.off ?? []), onClose, onSubmitted }
  const view = render(<FinishReviewDialog {...props} draft={draft} />)
  await waitFor(() => expect(calls('prReview.check').length).toBeGreaterThan(0))
  await settle()
  return { view, onSubmitted, onClose, props, FinishReviewDialog }
}

const dialog = (): HTMLElement => screen.getByTestId('pr-review-finish-dialog')
const radio = (name: string): HTMLElement => within(dialog()).getByRole('radio', { name })
const submit = (): HTMLElement => within(dialog()).getByTestId('pr-review-submit')
const summary = (): HTMLTextAreaElement => within(dialog()).getByTestId('pr-review-summary') as HTMLTextAreaElement
const disabled = (element: HTMLElement): boolean => element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'

describe('the Finish review dialog', () => {
  it('starts on Comment whatever the agent suggests, and says what it suggests', async () => {
    preload()
    await mount(draftOf([{ comment: on(2, 'A.'), by: 'agent' }], { suggestedEvent: 'REQUEST_CHANGES', agent: { sessionId: 's-1', state: 'done' } }))
    expect(radio('Comment').getAttribute('aria-checked')).toBe('true')
    expect(radio('Request changes').getAttribute('aria-checked')).toBe('false')
    expect(within(dialog()).getByTestId('pr-review-dialog-suggests').textContent).toContain('The agent suggests: Request changes')
    fireEvent.click(submit())
    await waitFor(() => expect(calls('prReview.submit')).toHaveLength(1))
    expect(calls('prReview.submit')[0]!.event).toBe('COMMENT')
  })

  it('without a suggestion there is no such line', async () => {
    preload()
    await mount(draftOf([{ comment: on(2, 'A.'), by: 'person' }]))
    expect(within(dialog()).queryByTestId('pr-review-dialog-suggests')).toBeNull()
  })

  it("on the person's own PR Approve and Request changes are inactive, with GitHub's rule as the reason", async () => {
    preload()
    await mount(draftOf([{ comment: on(2, 'A.'), by: 'person' }]), { mine: true })
    for (const name of ['Approve', 'Request changes']) {
      expect(disabled(radio(name)), name).toBe(true)
      expect(radio(name).getAttribute('title')).toBe('GitHub does not let you approve or request changes on your own pull request')
      fireEvent.click(radio(name))
    }
    expect(radio('Comment').getAttribute('aria-checked')).toBe('true')
    expect(disabled(radio('Comment'))).toBe(false)
  })

  it('Comment and Request changes are inactive without a summary and without comments; Approve is not', async () => {
    preload()
    await mount(draftOf([]))
    expect(disabled(submit())).toBe(true)
    expect(submit().getAttribute('title')).toBe('GitHub needs a summary or a comment for this verdict')
    fireEvent.click(radio('Request changes'))
    expect(disabled(submit())).toBe(true)
    fireEvent.click(radio('Approve'))
    expect(disabled(submit())).toBe(false)
    fireEvent.click(radio('Comment'))
    fireEvent.change(summary(), { target: { value: 'Looks good.' } })
    expect(disabled(submit())).toBe(false)
    fireEvent.click(submit())
    await waitFor(() => expect(calls('prReview.submit')).toHaveLength(1))
    expect(calls('prReview.submit')[0]).toMatchObject({ event: 'COMMENT', body: 'Looks good.', comments: [] })
  })

  it('lists every comment as it goes, «by the agent» on the agent’s; Remove keeps one out of the POST', async () => {
    preload()
    const mine = on(2, 'Mine.')
    const agents = on(5, 'The agent: cap it.', { start_line: 3, start_side: 'RIGHT' })
    const removed = on(8, 'The agent: not this one.')
    await mount(draftOf([{ comment: mine, by: 'person' }, { comment: agents, by: 'agent' }, { comment: removed, by: 'agent' }]))
    expect(within(dialog()).getByTestId('pr-review-dialog-count').textContent).toBe('3 comments will be posted on 3f2a9c1, exactly as below')
    const items = within(dialog()).getAllByTestId('pr-review-dialog-comment')
    expect(items.map((item) => within(item).getByTestId('pr-review-dialog-where').textContent)).toEqual(['src/net/retry.ts:2', 'src/net/retry.ts:3–5by the agent', 'src/net/retry.ts:8by the agent'])
    expect(items.map((item) => within(item).getByTestId('pr-review-dialog-body').textContent)).toEqual(['Mine.', 'The agent: cap it.', 'The agent: not this one.'])
    fireEvent.click(within(items[2]!).getByRole('button', { name: 'Remove' }))
    expect(within(dialog()).getByTestId('pr-review-dialog-count').textContent).toBe('2 comments will be posted on 3f2a9c1, exactly as below')
    fireEvent.click(submit())
    await waitFor(() => expect(calls('prReview.submit')).toHaveLength(1))
    expect(calls('prReview.submit')[0]).toEqual({ projectId: PROJECT, repo: REPO, number: NUMBER, event: 'COMMENT', body: '', comments: [mine, agents], commit: START, head: START })
  })

  it('a comment not on a changed line keeps Submit inactive until it is removed', async () => {
    preload()
    await mount(draftOf([{ comment: on(2, 'On.'), by: 'person' }, { comment: on(40, 'Off.'), by: 'agent' }]), { off: [1] })
    const items = within(dialog()).getAllByTestId('pr-review-dialog-comment')
    expect(items[1]!.textContent).toContain('Not posted · not on a changed line')
    expect(disabled(submit())).toBe(true)
    fireEvent.click(within(items[1]!).getByRole('button', { name: 'Remove' }))
    expect(disabled(submit())).toBe(false)
  })

  it('keeps the texts it opened with: a draft changed meanwhile does not change what goes', async () => {
    preload()
    const draft = draftOf([{ comment: on(2, 'As shown.'), by: 'person' }], { payload: { body: 'Summary shown.', comments: [on(2, 'As shown.')] } })
    const { view, props, FinishReviewDialog } = await mount(draft)
    view.rerender(<FinishReviewDialog {...props} draft={draftOf([{ comment: on(2, 'Written later.'), by: 'agent' }], { payload: { body: 'Later.', comments: [on(2, 'Written later.')] } })} />)
    await settle()
    expect(summary().value).toBe('Summary shown.')
    fireEvent.click(submit())
    await waitFor(() => expect(calls('prReview.submit')).toHaveLength(1))
    expect(calls('prReview.submit')[0]).toMatchObject({ body: 'Summary shown.', comments: [on(2, 'As shown.')] })
  })

  it('the head moved: «Your comments are on <a>; the head is <b>.», Submit on <a>, the comments on <a>', async () => {
    preload()
    await mount(draftOf([{ comment: on(2, 'A.'), by: 'person' }]), { head: MOVED })
    expect(within(dialog()).getByTestId('pr-review-dialog-moved').textContent).toContain('Your comments are on 3f2a9c1; the head is 7d0e4b2.')
    expect(submit().textContent).toBe('Submit on 3f2a9c1')
    fireEvent.click(submit())
    await waitFor(() => expect(calls('prReview.submit')).toHaveLength(1))
    expect(calls('prReview.submit')[0]).toMatchObject({ commit: START, head: MOVED })
  })

  it('a head that moved while the dialog was open comes back from main and is shown; the next Submit names it', async () => {
    let first = true
    preload({
      submit: () => {
        const answer: PrReviewSubmitAnswer = first
          ? { outcome: 'refused', reason: 'Not submitted: the head of example-org/web#77 moved to 7d0e4b2 since the dialog opened. Look at it again', reviewUrl: null, head: MOVED, draft: null }
          : { outcome: 'submitted', reason: null, reviewUrl: 'https://github.com/x', head: null, draft: null }
        first = false
        return answer
      },
    })
    const { onSubmitted } = await mount(draftOf([{ comment: on(2, 'A.'), by: 'person' }]))
    expect(submit().textContent).toBe('Submit review')
    fireEvent.click(submit())
    await waitFor(() => expect(within(dialog()).getByTestId('pr-review-dialog-reason').textContent).toContain('moved to 7d0e4b2'))
    expect(submit().textContent).toBe('Submit on 3f2a9c1')
    expect(onSubmitted).not.toHaveBeenCalled()
    fireEvent.click(submit())
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    expect(calls('prReview.submit')[1]).toMatchObject({ commit: START, head: MOVED })
  })

  it('Enter does not submit; ⌘↵ does, once; a second click while it runs posts nothing more', async () => {
    let release: () => void = () => undefined
    let asked = 0
    preload()
    const bridge = (globalThis as { worfy?: WorfyBridge }).worfy!
    const invoke = bridge.invoke
    // The answer of main waits until the test lets it go: Submit is running meanwhile.
    bridge.invoke = (channel, input) => {
      if (channel !== 'prReview.submit') return invoke(channel, input)
      asked += 1
      return new Promise((done) => (release = () => done(invoke(channel, input) as never)))
    }
    await mount(draftOf([{ comment: on(2, 'A.'), by: 'person' }]))
    fireEvent.keyDown(summary(), { key: 'Enter' })
    fireEvent.keyDown(submit(), { key: 'Enter' })
    await settle()
    expect(asked).toBe(0)
    fireEvent.keyDown(summary(), { key: 'Enter', metaKey: true })
    await settle()
    expect(asked).toBe(1)
    fireEvent.click(submit())
    fireEvent.keyDown(summary(), { key: 'Enter', metaKey: true })
    await settle()
    expect(asked).toBe(1)
    release()
    await settle()
    expect(calls('prReview.submit')).toHaveLength(1)
  })

  it('the line of review-draft-lint: checked; a finding keeps Submit inactive and says what it found', async () => {
    preload({ check: (input) => ({ findings: (input.body as string).includes('.scratch') ? ['body: .scratch ".scratch"'] : [], reason: null }) })
    await mount(draftOf([{ comment: on(2, 'A.'), by: 'person' }]))
    await waitFor(() => expect(within(dialog()).getByTestId('pr-review-dialog-lint').textContent).toBe('Checked: no workflow traces, no AI signature, no personal data'))
    fireEvent.change(summary(), { target: { value: 'See .scratch/notes.' } })
    await waitFor(() => expect(within(dialog()).getByTestId('pr-review-dialog-lint').textContent).toContain('body: .scratch ".scratch"'), { timeout: ms(3000) })
    expect(disabled(submit())).toBe(true)
  })

  it('a draft whose Submit GitHub did not confirm opens on the texts that went, locked: its verdict, its summary, no Remove', async () => {
    preload()
    const went = on(2, 'Cap the retries.')
    await mount(draftOf([{ comment: went, by: 'person' }], { error: `${UNCONFIRMED}: gh: Bad Gateway (HTTP 502)`, payload: { event: 'APPROVE', body: 'Ship it.', comments: [went] } }))
    expect(within(dialog()).getByTestId('pr-review-dialog-unfinished')).toBeTruthy()
    expect(radio('Approve').getAttribute('aria-checked')).toBe('true')
    expect(disabled(radio('Comment'))).toBe(true)
    expect(disabled(radio('Request changes'))).toBe(true)
    fireEvent.click(radio('Comment'))
    expect(radio('Approve').getAttribute('aria-checked')).toBe('true')
    expect(summary().value).toBe('Ship it.')
    expect(summary().readOnly).toBe(true)
    expect(within(dialog()).queryByRole('button', { name: 'Remove' })).toBeNull()
    fireEvent.click(submit())
    await waitFor(() => expect(calls('prReview.submit')).toHaveLength(1))
    expect(calls('prReview.submit')[0]).toEqual({ projectId: PROJECT, repo: REPO, number: NUMBER, event: 'APPROVE', body: 'Ship it.', comments: [went], commit: START, head: START })
  })

  it('Cancel closes without a POST', async () => {
    preload()
    const { onClose } = await mount(draftOf([{ comment: on(2, 'A.'), by: 'person' }]))
    fireEvent.click(within(dialog()).getByTestId('pr-review-dialog-cancel'))
    expect(onClose).toHaveBeenCalled()
    expect(calls('prReview.submit')).toEqual([])
  })
})
