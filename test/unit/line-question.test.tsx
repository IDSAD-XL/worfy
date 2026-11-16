// A question about lines of a Code story (worfy-code-stories ticket 12): lines selected in the code of a step open a
// question field after them (src/renderer/stories/LineQuestion.tsx); the progress bar stands in its place while the
// invisible agent answers; the answer appears after the same lines, with its source and the lines it rests on. An
// answer with nothing to rest on says so in the story's words. main is stood in; its side is test/unit/story-ask.test.ts.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryAnswer, StoryAskOutcome } from '../../src/shared/ipc/stories'
import { storySchema, type Story, type StoryFile } from '../../src/shared/stories/schema'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  subscribe: vi.fn(),
  hasPreloadBridge: () => false,
  windowMachine: () => null,
}))
vi.mock('../../src/renderer/ipc', () => ipc)

const { StoryView } = await import('../../src/renderer/stories/StoryView')
const { LineAnswer } = await import('../../src/renderer/stories/LineQuestion')
const { storyOwnCode } = await import('../../src/renderer/stories/open')
const { Markdown } = await import('../../src/renderer/markdown/Markdown')

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'code-story-answers')
const HEAD = 'a'.repeat(40)
const DIGEST = 'b'.repeat(64)
/** The Russian PR story of the shared cases; a new object each time, as each opening of a story reads it anew. */
const story = (): Story =>
  storySchema.parse({
    kind: 'pr',
    header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'ru', commit: HEAD },
    ...(JSON.parse(readFileSync(join(FIXTURES, 'pr-ru.json'), 'utf8')) as object),
  })
const STORY = story()

const ANSWER: StoryAnswer = {
  at: '2026-11-16T12:00:00.000Z',
  question: 'Why skip a zero quantity?',
  answer: 'A line with no items adds nothing.',
  source: 'code',
  about: { step: 2, path: 'src/coupon.ts', from: 11, to: 12 },
  lines: [`src/coupon.ts:11@${HEAD}`],
  digest: DIGEST,
}

let listeners: ((payload: { storyId: string; text: string }) => void)[]
let answer: (result: { ok: true; value: StoryAskOutcome }) => void
/** What main answers to stories.answers: the digest of the shown story and the answers kept for it. */
let kept: { digest: string; answers: StoryAnswer[] }

beforeEach(() => {
  listeners = []
  kept = { digest: DIGEST, answers: [] }
  ipc.subscribe.mockReset()
  ipc.subscribe.mockImplementation((channel: string, handler: (payload: { storyId: string; text: string }) => void) => {
    if (channel === 'stories.activity') listeners.push(handler)
    return () => {
      listeners = listeners.filter((listener) => listener !== handler)
    }
  })
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation((channel: string) => {
    if (channel === 'stories.ask') return new Promise((resolve) => (answer = resolve))
    if (channel === 'stories.answers') return Promise.resolve({ ok: true, value: kept })
    return Promise.resolve({ ok: true, value: { stopped: true } })
  })
})

afterEach(() => {
  cleanup()
})

/** The view at the first code step of the story (screen 2), with the code shown. */
async function atCodeStep(): Promise<HTMLElement> {
  render(<StoryView story={story()} codeOf={storyOwnCode} projectId="project-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Next screen' }))
  return screen.findByTestId('md-story-code')
}

/** Selects lines `from`..`to` of the shown code, as a drag of the mouse does, and lets the mouse go. */
function selectLines(code: HTMLElement, from: number, to: number): void {
  const first = code.querySelector(`[data-line="${String(from)}"] .w-md__story-text`)!
  const last = code.querySelector(`[data-line="${String(to)}"] .w-md__story-text`)!
  const range = document.createRange()
  range.setStart(first.firstChild!, 0)
  range.setEnd(last.firstChild!, 3)
  const selection = globalThis.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.mouseUp(last)
}

/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('a question about lines of a Code story', () => {
  it('opens the field after the selected lines; the progress bar stands in its place; the answer appears after the same lines', async () => {
    const code = await atCodeStep()
    selectLines(code, 11, 12)
    const field = await screen.findByRole('textbox', { name: 'Вопрос о строках 11–12' })
    const view = screen.getByTestId('story-view')
    expect(before(view.querySelector('[data-line="12"]')!, field)).toBe(true)
    expect(before(field, view.querySelector('[data-line="13"]')!)).toBe(true)
    expect(view.querySelector('[data-line="11"]')?.getAttribute('data-selected')).toBe('true')

    fireEvent.change(field, { target: { value: 'Why skip a zero quantity?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Спросить' }))
    const asked = ipc.invoke.mock.calls.find(([channel]) => channel === 'stories.ask')![1] as { questionId: string; projectId: string; story: StoryFile; about: unknown; code: string; question: string }
    expect(asked).toMatchObject({ projectId: 'project-1', story: STORY, about: { step: 2, path: 'src/coupon.ts', from: 11, to: 12 }, question: 'Why skip a zero quantity?' })
    expect(asked.code).toBe('  if (coupon.expires < today) return 0\n  if (coupon.percent <= 0) return 0')

    const progress = await screen.findByTestId('line-question-progress')
    expect(screen.queryByRole('textbox')).toBeNull()
    act(() => listeners.forEach((listener) => listener({ storyId: asked.questionId, text: 'Read src/cart.ts' })))
    expect(within(progress).getByText('Read src/cart.ts')).toBeTruthy()

    await act(async () => answer({ ok: true, value: { status: 'answer', answer: ANSWER } }))
    const shown = await screen.findByTestId('line-answer')
    expect(shown.textContent).toContain('A line with no items adds nothing.')
    expect(shown.textContent).toContain('src/coupon.ts:11')
    // The link's commit stays in its title; the line shows the place only. The source is named in the story's words.
    expect(shown.textContent).not.toContain('@')
    expect(within(shown).getByText('Код')).toBeTruthy()
    expect(shown.getAttribute('data-source')).toBe('code')
    expect(shown.dataset.earlier).toBeUndefined()
    expect(before(view.querySelector('[data-line="12"]')!, shown)).toBe(true)
    expect(before(shown, view.querySelector('[data-line="13"]')!)).toBe(true)
    expect(screen.queryByTestId('line-question-progress')).toBeNull()
  })

  it('Stop ends the answer: main is asked to stop it, and nothing is shown as an answer', async () => {
    const code = await atCodeStep()
    selectLines(code, 11, 11)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Вопрос о строке 11' }), { target: { value: 'Why?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Спросить' }))
    await screen.findByTestId('line-question-progress')
    fireEvent.click(screen.getByRole('button', { name: 'Стоп' }))
    const asked = ipc.invoke.mock.calls.find(([channel]) => channel === 'stories.ask')![1] as { questionId: string }
    expect(ipc.invoke).toHaveBeenCalledWith('stories.stop', { storyId: asked.questionId })
    await act(async () => answer({ ok: true, value: { status: 'stopped' } }))
    expect((await screen.findByTestId('line-question-progress')).dataset.state).toBe('stopped')
    expect(screen.queryByTestId('line-answer')).toBeNull()
  })

  it('shows the reason of a Project whose Vendor has no oneShot in the place of the field', async () => {
    const code = await atCodeStep()
    selectLines(code, 11, 11)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Вопрос о строке 11' }), { target: { value: 'Why?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Спросить' }))
    await act(async () => answer({ ok: true, value: { status: 'unavailable', reason: 'One-off requests run on Claude Code only.' } }))
    const bar = await screen.findByTestId('line-question-progress')
    expect(bar.dataset.state).toBe('unavailable')
    expect(bar.textContent).toContain('One-off requests run on Claude Code only.')
  })

  it("shows an answer with nothing to rest on in the story's words for 'no support' (Russian), with no lines", () => {
    render(<LineAnswer answer={{ ...ANSWER, source: 'none', answer: 'Опоры нет: story и код об этом молчат.', lines: [] }} language="ru" />)
    const shown = screen.getByTestId('line-answer')
    expect(shown.dataset.source).toBe('none')
    expect(within(shown).getByText('опоры нет')).toBeTruthy()
  })

  it('keeps the progress bar of a running question when other lines are selected; the answer closes no other field', async () => {
    const code = await atCodeStep()
    selectLines(code, 11, 11)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Вопрос о строке 11' }), { target: { value: 'Why?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Спросить' }))
    await screen.findByTestId('line-question-progress')
    selectLines(code, 13, 14)
    const askButton = screen.getByRole('button', { name: 'Задать вопрос' })
    expect(askButton.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(askButton)
    expect(screen.getByTestId('line-question-progress').dataset.state).toBe('running')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByTestId('story-view').querySelector('[data-line="13"]')?.getAttribute('data-selected')).toBeNull()
    await act(async () => answer({ ok: true, value: { status: 'answer', answer: { ...ANSWER, about: { ...ANSWER.about, from: 11, to: 11 } } } }))
    expect(await screen.findByTestId('line-answer')).toBeTruthy()
    // Now the lines can be asked about again.
    expect(screen.getByRole('button', { name: 'Задать вопрос' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('Cancel and Esc give the focus back to «Ask a question»', async () => {
    await atCodeStep()
    const askButton = screen.getByRole('button', { name: 'Задать вопрос' })
    fireEvent.click(askButton)
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(askButton)
    fireEvent.click(askButton)
    fireEvent.keyDown(await screen.findByRole('textbox', { name: 'Вопрос о строках 10–15' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(askButton)
  })

  it('shows the kept answers of this step only, and marks one asked about an earlier text of the story', async () => {
    kept = {
      digest: DIGEST,
      answers: [
        { ...ANSWER, question: 'Of this step, this text' },
        { ...ANSWER, question: 'Of another step', about: { ...ANSWER.about, step: 3 } },
        { ...ANSWER, question: 'Of this step, an earlier text', digest: 'c'.repeat(64) },
      ],
    }
    await atCodeStep()
    const shown = await screen.findAllByTestId('line-answer')
    expect(shown.map((one) => one.querySelector('.w-line-answer__question')?.textContent)).toEqual(['Of this step, this text', 'Of this step, an earlier text'])
    expect(shown[0]!.dataset.earlier).toBeUndefined()
    expect(shown[1]!.dataset.earlier).toBe('true')
    expect(shown[1]!.textContent).toContain('Вопрос задан к прежнему тексту story')
  })

  it('says so when an answer that rests on the code could not link its lines', () => {
    render(<LineAnswer answer={{ ...ANSWER, lines: [] }} language="en" />)
    expect(screen.getByTestId('line-answer').textContent).toContain('The quoted lines are not linked: git named no commit of the checkout.')
  })
})

describe('the code block of a story with and without something after a line', () => {
  const block = '```story from=10 key=11\nfirst\nsecond\nthird\n```'

  it('is one <pre> when nothing stands after a line, and runs of <pre> with the aside between them otherwise', () => {
    const { unmount } = render(<Markdown text={block} story />)
    expect(screen.getByTestId('md-story-code').tagName).toBe('PRE')
    unmount()
    render(<Markdown text={block} story storyAside={(line) => (line === 11 ? <span data-testid="aside">after 11</span> : null)} />)
    const runs = screen.getByTestId('md-story-code')
    expect(runs.tagName).toBe('DIV')
    expect(runs.querySelectorAll('pre')).toHaveLength(2)
    const aside = screen.getByTestId('aside')
    expect(before(runs.querySelector('[data-line="11"]')!, aside)).toBe(true)
    expect(before(aside, runs.querySelector('[data-line="12"]')!)).toBe(true)
  })
})
