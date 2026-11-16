// "Check yourself" and the "read" marks of a Code story (worfy-code-stories ticket 13; spec, owner decision 15, stories 20
// and 21) on the shared answers of test/fixtures/code-story-answers/. The last screen of a story with questions is
// "Check yourself" (src/renderer/stories/SelfCheck.tsx): the right answer stays hidden until the person answers — in
// their own words or with "I don't know" — and then shows with its lines, each a link that opens the step with those
// lines. A story without questions has no such screen. The screens read and the answers are kept by main
// (src/main/stories/store.ts, stories.json of worfy's data) under the key it names (`stories.marks`); a step is named
// by its Ticket and its number inside it, so a mark stays on its step when an earlier chapter of an Epic becomes ready.
// main is stood in; its side is test/contract/story-store.test.ts and test/contract/stories-handler.test.ts.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryReadMark, StorySelfCheck } from '../../src/shared/ipc/stories'
import { storySchema, type Story, type StoryLanguage } from '../../src/shared/stories/schema'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  hasPreloadBridge: () => false,
  windowMachine: () => null,
}))
vi.mock('../../src/renderer/ipc', () => ipc)

const { StoryView } = await import('../../src/renderer/stories/StoryView')
const { storyOwnCode } = await import('../../src/renderer/stories/open')

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'code-story-answers')
const answer = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Record<string, unknown>
const HEAD = 'a'.repeat(40)
const KEY = 'example-org/demo-cart#212'

const prStory = (name: 'pr-en' | 'pr-ru', language: StoryLanguage): Story =>
  storySchema.parse({ kind: 'pr', header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language, commit: HEAD }, ...answer(name) })
const epicStory = (): Story => storySchema.parse({ kind: 'epic', header: { epic: 'demo-cart', language: 'ru' }, ...answer('epic-ru') })

/** What main keeps for the story: the screens read and the answers to "Check yourself". */
let kept: { key: string; read: StoryReadMark[]; checks: StorySelfCheck[] }

beforeEach(() => {
  kept = { key: KEY, read: [], checks: [] }
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation((channel: string, payload: { answer?: { question: string; answer: string | null } }) => {
    if (channel === 'stories.marks') return Promise.resolve({ ok: true, value: kept })
    if (channel === 'stories.selfCheck') return Promise.resolve({ ok: true, value: { at: '2026-11-16T12:00:00.000Z', ...payload.answer } })
    if (channel === 'stories.markRead') return Promise.resolve({ ok: true, value: { kept: true } })
    return Promise.resolve({ ok: true, value: { digest: 'b'.repeat(64), answers: [] } })
  })
})

afterEach(() => {
  cleanup()
})

const segments = () => screen.getAllByTestId('story-segment')
const states = () => segments().map((segment) => segment.dataset.state)
const shownScreen = () => screen.getByTestId('story-screen')
const calls = (channel: string) => ipc.invoke.mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload as Record<string, unknown>)

describe('"Check yourself": the last screen of a story with questions', () => {
  it('hides the right answer until the person answers in their own words, then shows it with links that open the step with those lines', async () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} projectId="project-1" />)
    fireEvent.click(segments().at(-1)!)
    expect(shownScreen().dataset.kind).toBe('check-yourself')
    const questions = within(shownScreen()).getAllByTestId('self-check-question')
    expect(questions).toHaveLength(2)
    // The right answer is not on the page before the person answers.
    expect(shownScreen().textContent).not.toContain('whole numbers add without drift')
    expect(within(questions[0]!).queryByTestId('self-check-answer')).toBeNull()

    const field = within(questions[0]!).getByRole('textbox', { name: 'Your answer to question 1' })
    const check = within(questions[0]!).getByRole('button', { name: 'Check' })
    // An empty answer checks nothing.
    fireEvent.click(check)
    expect(within(questions[0]!).queryByTestId('self-check-answer')).toBeNull()
    fireEvent.change(field, { target: { value: 'Floats drift; cents are whole.' } })
    fireEvent.click(check)

    const shown = await within(questions[0]!).findByTestId('self-check-answer')
    expect(shown.textContent).toContain('whole numbers add without drift')
    expect(within(questions[0]!).getByTestId('self-check-mine').textContent).toContain('Floats drift; cents are whole.')
    // The other question stays hidden.
    expect(within(questions[1]!).queryByTestId('self-check-answer')).toBeNull()
    expect(calls('stories.selfCheck')).toEqual([{ projectId: 'project-1', key: KEY, answer: { question: 'Why does the total multiply whole cents and not the typed price?', answer: 'Floats drift; cents are whole.' } }])

    // src/cart.ts:14 is a line of step 2; src/money.ts:11 is in no step of this story: it is named, not linked.
    expect(within(shown).queryByRole('button', { name: /src\/money\.ts:11/u })).toBeNull()
    expect(shown.textContent).toContain('src/money.ts:11')
    fireEvent.click(within(shown).getByRole('button', { name: /src\/cart\.ts:14/u }))
    expect(screen.getByTestId('story-position').textContent).toContain('2 of 6')
    expect(screen.getByTestId('story-code').dataset.path).toBe('src/cart.ts')
  })

  it('takes "I don\'t know" as an answer too: the right one shows, and the choice is kept', async () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} projectId="project-1" />)
    fireEvent.click(segments().at(-1)!)
    const second = within(shownScreen()).getAllByTestId('self-check-question')[1]!
    fireEvent.click(within(second).getByRole('button', { name: "I don't know" }))
    const shown = await within(second).findByTestId('self-check-answer')
    expect(shown.textContent).toContain('does not let a cart of such lines reach checkout')
    expect(within(second).getByTestId('self-check-mine').textContent).toContain("I don't know")
    expect(calls('stories.selfCheck')[0]!.answer).toEqual({ question: 'What does the cart do with a line whose quantity is 0?', answer: null })
    // src/cart.ts:21 opens step 3.
    fireEvent.click(within(shown).getByRole('button', { name: /src\/cart\.ts:21/u }))
    expect(screen.getByTestId('story-position').textContent).toContain('3 of 6')
  })

  it('⌘↩ in the field checks an answer, and an empty field checks nothing', async () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} projectId="project-1" />)
    fireEvent.click(segments().at(-1)!)
    const first = within(shownScreen()).getAllByTestId('self-check-question')[0]!
    const field = within(first).getByRole('textbox', { name: 'Your answer to question 1' })
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true })
    expect(within(first).queryByTestId('self-check-answer')).toBeNull()
    fireEvent.change(field, { target: { value: 'Cents are whole.' } })
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true })
    expect((await within(first).findByTestId('self-check-mine')).textContent).toContain('Cents are whole.')
  })

  it('in an Epic story a link opens the step of the chapter that quotes those lines', async () => {
    render(<StoryView story={epicStory()} codeOf={storyOwnCode} projectId="project-1" />)
    fireEvent.click(segments().at(-1)!)
    const first = within(shownScreen()).getAllByTestId('self-check-question')[0]!
    fireEvent.change(within(first).getByRole('textbox', { name: 'Ваш ответ на вопрос 1' }), { target: { value: 'Берёт меньшее.' } })
    fireEvent.click(within(first).getByRole('button', { name: 'Проверить' }))
    const shown = await within(first).findByTestId('self-check-answer')
    fireEvent.click(within(shown).getByRole('button', { name: /src\/coupon\.ts:14/u }))
    // Start, two steps of 03, one of 04: the first step of 05 is screen 5.
    expect(screen.getByTestId('story-position').textContent).toContain('5 of 11')
    expect(screen.getByTestId('story-code').dataset.path).toBe('src/coupon.ts')
  })

  it('shows an answer main kept, without asking again; the controls are reachable by Tab', async () => {
    kept.checks = [{ at: '2026-11-15T10:00:00.000Z', question: 'What does the cart do with a line whose quantity is 0?', answer: 'Skips it.' }]
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} projectId="project-1" />)
    fireEvent.click(segments().at(-1)!)
    const [first, second] = within(shownScreen()).getAllByTestId('self-check-question')
    expect((await within(second!).findByTestId('self-check-answer')).textContent).toContain('does not let a cart of such lines reach checkout')
    expect(within(second!).getByTestId('self-check-mine').textContent).toContain('Skips it.')
    expect(within(first!).queryByTestId('self-check-answer')).toBeNull()
    for (const control of [within(first!).getByRole('textbox'), within(first!).getByRole('button', { name: 'Check' }), within(first!).getByRole('button', { name: "I don't know" })]) {
      expect(control.tabIndex).toBe(0)
    }
  })

  it('says it is optional, in the story language', () => {
    render(<StoryView story={epicStory()} codeOf={storyOwnCode} />)
    fireEvent.click(segments().at(-1)!)
    expect(shownScreen().textContent).toContain('Необязательно')
    expect(shownScreen().textContent).toContain('От ответов ничего не зависит.')
  })
})

describe('a story without questions', () => {
  it('has no "Check yourself" screen', () => {
    render(<StoryView story={prStory('pr-ru', 'ru')} codeOf={storyOwnCode} projectId="project-1" />)
    expect(segments()).toHaveLength(5)
    fireEvent.click(segments().at(-1)!)
    expect(shownScreen().dataset.kind).toBe('step')
    expect(screen.queryAllByTestId('self-check-question')).toHaveLength(0)
    expect(screen.getByTestId('story-view').textContent).not.toContain('Проверить себя')
  })
})

describe('the "read" marks: kept by main, by the Ticket and the step inside it', () => {
  it('marks the screens main kept as read, and tells main each screen shown', async () => {
    kept.read = [{ ticket: '04', step: 3 }, { ticket: '04', step: 5 }]
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} projectId="project-1" />)
    await waitFor(() => expect(states()).toEqual(['current', 'unread', 'read', 'unread', 'read', 'unread']))
    // The first screen is read as soon as it shows.
    await waitFor(() => expect(calls('stories.markRead')).toEqual([{ projectId: 'project-1', key: KEY, mark: { ticket: '04', step: 1 } }]))
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Next screen' }))
    })
    expect(states()).toEqual(['read', 'current', 'read', 'unread', 'read', 'unread'])
    await waitFor(() => expect(calls('stories.markRead').at(-1)).toEqual({ projectId: 'project-1', key: KEY, mark: { ticket: '04', step: 2 } }))
    // A screen main already keeps is not sent again; "Check yourself" is a screen of its own.
    fireEvent.click(segments()[2]!)
    fireEvent.click(segments()[5]!)
    await waitFor(() => expect(calls('stories.markRead').at(-1)!.mark).toEqual({ screen: 'check-yourself' }))
    expect(calls('stories.markRead').map((call) => call.mark)).not.toContainEqual({ ticket: '04', step: 3 })
  })

  it('an Epic story: a step mark names its chapter, so it stays on its step whatever comes before it', async () => {
    // The first step of chapter 05 and Seams were read; the screens before them may have changed in number since.
    kept.read = [{ ticket: '05', step: 1 }, { screen: 'seams' }]
    render(<StoryView story={epicStory()} codeOf={storyOwnCode} projectId="project-1" />)
    // Start, 03 ×2, 04, 05 ×2, 06 not ready, Seams, Summary, Check, Check yourself.
    await waitFor(() => expect(states()).toEqual(['current', 'unread', 'unread', 'unread', 'read', 'unread', 'unread', 'read', 'unread', 'unread', 'unread']))
    fireEvent.click(segments()[2]!)
    await waitFor(() => expect(calls('stories.markRead').at(-1)!.mark).toEqual({ ticket: '03', step: 2 }))
    // A chapter not ready has no step: its screen is not kept.
    fireEvent.click(segments()[6]!)
    fireEvent.click(segments()[8]!)
    await waitFor(() => expect(calls('stories.markRead').at(-1)!.mark).toEqual({ screen: 'summary' }))
    expect(calls('stories.markRead').map((call) => call.mark)).toEqual([{ screen: 'start' }, { ticket: '03', step: 2 }, { screen: 'summary' }])
  })

  it('without a Project nothing is kept or read', () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} />)
    fireEvent.click(segments()[1]!)
    expect(calls('stories.marks')).toHaveLength(0)
    expect(calls('stories.markRead')).toHaveLength(0)
  })
})
