// The Story view (src/renderer/stories/StoryView.tsx, worfy-code-stories ticket 09) on the shared Code story
// answers of test/fixtures/code-story-answers/: the presentation «Stories» — one screen at a time, the bar of
// segments with the screens seen marked, the right half and → go on, the left half and ← go back; the chapters of
// an Epic story; one column on a narrow view; the code of a fragment with its line numbers and key lines; the
// diagram of "Seams between tickets"; and Esc back to the Canvas.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { storySchema, type Story, type StoryLanguage } from '../../src/shared/stories/schema'
import { setView, useNavigation } from '../../src/renderer/session/navigation'
import { openStory, storyOwnCode, type FragmentCodeSource } from '../../src/renderer/stories/open'
import { StoryScreen, StoryView } from '../../src/renderer/stories/StoryView'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'code-story-answers')
const answer = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Record<string, unknown>
const HEAD = 'a'.repeat(40)

const prStory = (name: 'pr-en' | 'pr-ru', language: StoryLanguage): Story =>
  storySchema.parse({ kind: 'pr', header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language, commit: HEAD }, ...answer(name) })
const epicStory = (): Story => storySchema.parse({ kind: 'epic', header: { epic: 'demo-cart', language: 'ru' }, ...answer('epic-ru') })

let observers: { callback: ResizeObserverCallback }[] = []

/** jsdom has no ResizeObserver: this one hands the view the width a test gives it. */
class FakeResizeObserver {
  constructor(public callback: ResizeObserverCallback) {
    observers.push(this)
  }
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

const resizeTo = (width: number) =>
  act(() => {
    for (const observer of observers) observer.callback([{ contentRect: { width } } as ResizeObserverEntry], observer as unknown as ResizeObserver)
  })

beforeEach(() => {
  observers = []
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver
  const bridge = { invoke: () => Promise.resolve({ ok: true, value: {} }), on: () => 1, off: () => undefined } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  setView('canvas')
})

const segments = () => screen.getAllByTestId('story-segment')
const states = () => segments().map((segment) => segment.dataset.state)
const shownScreen = () => screen.getByTestId('story-screen')
const press = (key: string) => fireEvent.keyDown(document.body, { key })

/** A click on the stage at `x` of its 1000 px width: under 500 the left half, else the right. */
function clickStage(x: number): void {
  const stage = screen.getByTestId('story-stage')
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.click(stage, { clientX: x, clientY: 300 })
}

describe('the story of a PR: one screen per step, the segments, the halves and the arrows', () => {
  it('has as many screens as steps, marks the screens seen, and turns with the right half, →, the left half and ←', () => {
    render(<StoryView story={prStory('pr-ru', 'ru')} codeOf={storyOwnCode} />)
    // pr-ru has five steps and no "Check yourself".
    expect(segments()).toHaveLength(5)
    expect(states()).toEqual(['current', 'unread', 'unread', 'unread', 'unread'])
    expect(shownScreen().dataset.kind).toBe('step')
    expect(within(shownScreen()).getByRole('heading', { level: 2 }).textContent).toContain('Что было не так')

    press('ArrowRight')
    expect(states()).toEqual(['read', 'current', 'unread', 'unread', 'unread'])
    expect(within(shownScreen()).getByRole('heading', { level: 2 }).textContent).toContain('Скидка не больше итога и только у живого купона')

    clickStage(800)
    expect(states()).toEqual(['read', 'read', 'current', 'unread', 'unread'])
    expect(screen.getByTestId('story-position').textContent).toContain('3 of 5')

    press('ArrowLeft')
    expect(screen.getByTestId('story-position').textContent).toContain('2 of 5')
    clickStage(100)
    expect(screen.getByTestId('story-position').textContent).toContain('1 of 5')
    expect(states()).toEqual(['current', 'read', 'read', 'unread', 'unread'])

    // ← on the first screen and a click on a segment.
    press('ArrowLeft')
    expect(screen.getByTestId('story-position').textContent).toContain('1 of 5')
    fireEvent.click(segments()[4]!)
    expect(screen.getByTestId('story-position').textContent).toContain('5 of 5')
    expect((screen.getByRole('button', { name: 'Next screen' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a click on the code or on a field tab does not turn the screen', () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} />)
    press('ArrowRight')
    fireEvent.click(screen.getByTestId('story-field-whyHere'))
    expect(screen.getByTestId('story-position').textContent).toContain('2 of 6')
  })

  it('ends with "Check yourself" when the story has questions', () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} />)
    expect(segments()).toHaveLength(6)
    fireEvent.click(segments()[5]!)
    expect(shownScreen().dataset.kind).toBe('check-yourself')
    expect(within(shownScreen()).getByRole('heading', { level: 2 }).textContent).toContain('Check yourself')
    expect(within(shownScreen()).getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows the fields of a code step in the story language, and "not recorded" in its words as it is', () => {
    render(<StoryView story={prStory('pr-ru', 'ru')} codeOf={storyOwnCode} />)
    fireEvent.click(segments()[2]!)
    expect(shownScreen().textContent).toContain('Что делает')
    expect(shownScreen().textContent).toContain('убирает пробелы и поднимает регистр')
    fireEvent.click(screen.getByTestId('story-field-whyHere'))
    expect(screen.getByTestId('story-field-panel').textContent).toMatch(/^не записано$/)
    fireEvent.click(screen.getByTestId('story-field-withoutIt'))
    expect(screen.getByTestId('story-field-panel').textContent).toContain('код, набранный строчными буквами, не находился бы.')
  })
})

describe('the story of an Epic: chapters over the segments', () => {
  it('has Start, a chapter per PR, Seams, Summary, Check and Check yourself, each with its screens', () => {
    render(<StoryView story={epicStory()} codeOf={storyOwnCode} />)
    const chapters = screen.getAllByTestId('story-chapter')
    expect(chapters.map((chapter) => chapter.dataset.chapter)).toEqual(['start', 'ticket-03', 'ticket-04', 'ticket-05', 'ticket-06', 'seams', 'summary', 'check', 'check-yourself'])
    expect(chapters.map((chapter) => chapter.textContent)).toEqual(['!Начало', '03#211', '04#212', '05#213', '06PR -', '⇄Стыки между Ticket-ами', '✓Итог', '✓Проверка', '?Проверить себя'])
    // Start, five code steps, the chapter not ready, Seams, Summary, Check, Check yourself.
    expect(segments()).toHaveLength(11)
    expect(shownScreen().dataset.kind).toBe('start')
    expect(chapters[0]!.getAttribute('aria-current')).toBe('true')

    fireEvent.click(chapters[2]!)
    expect(shownScreen().getAttribute('aria-label')).toBe('3. Итог — сумма целых центов')
    expect(within(shownScreen()).getByText('PR #212 · Ticket 04').isConnected).toBe(true)
    expect(screen.getAllByTestId('story-chapter')[2]!.getAttribute('aria-current')).toBe('true')

    fireEvent.click(screen.getAllByTestId('story-chapter')[4]!)
    expect(shownScreen().dataset.kind).toBe('not-ready')
    expect(shownScreen().textContent).toContain('PR ещё не открыт; передача от 05 к 04 ждёт этот Ticket.')

    for (const [at, kind, title] of [
      [5, 'seams', 'Стыки между Ticket-ами'],
      [6, 'summary', 'Итог'],
      [7, 'check', 'Проверка'],
    ] as const) {
      fireEvent.click(screen.getAllByTestId('story-chapter')[at]!)
      expect(shownScreen().dataset.kind).toBe(kind)
      expect(within(shownScreen()).getByRole('heading', { level: 2 }).textContent).toContain(title)
    }
    // The step "Seams between tickets" is numbered on from the last step of the chapters.
    fireEvent.click(screen.getAllByTestId('story-chapter')[5]!)
    expect(shownScreen().getAttribute('aria-label')).toBe('6. Стыки между Ticket-ами')
  })
})

describe('the layout: code left and text right on a wide view, one column on a narrow one', () => {
  const columns = () => [...shownScreen().querySelectorAll('[data-testid="story-code-column"], [data-testid="story-text-column"]')].map((column) => column.getAttribute('data-testid'))

  it('wide: the code column before the text column', () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} />)
    resizeTo(1400)
    press('ArrowRight')
    expect(screen.getByTestId('story-view').getAttribute('data-layout')).toBe('wide')
    expect(columns()).toEqual(['story-code-column', 'story-text-column'])
  })

  it('narrow: one column, the text first, and back to two when it widens', () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} />)
    press('ArrowRight')
    resizeTo(600)
    expect(screen.getByTestId('story-view').getAttribute('data-layout')).toBe('narrow')
    expect(columns()).toEqual(['story-text-column', 'story-code-column'])
    resizeTo(1200)
    expect(columns()).toEqual(['story-code-column', 'story-text-column'])
    // A hidden view measures 0 wide: that changes nothing.
    resizeTo(0)
    expect(screen.getByTestId('story-view').getAttribute('data-layout')).toBe('wide')
  })
})

describe('the code of a fragment', () => {
  it('numbers the lines from the first line and highlights the key lines', async () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={storyOwnCode} />)
    press('ArrowRight')
    const block = await screen.findByTestId('md-story-code')
    const lines = [...block.querySelectorAll<HTMLElement>('[data-line]')]
    expect(lines.map((line) => Number(line.dataset.line))).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
    expect(lines.filter((line) => line.dataset.key === 'true').map((line) => Number(line.dataset.line))).toEqual([13, 14])
    expect(screen.getByTestId('story-code').textContent).toContain('src/cart.ts:10–17')
  })

  it('shows what codeOf gives, against the PR head, and says when it is the code of the head', async () => {
    const asked: (string | null)[] = []
    const shifted: FragmentCodeSource = (fragment, head) => {
      asked.push(head)
      return Promise.resolve({ code: fragment.code, startLine: fragment.startLine + 3, keyLines: fragment.keyLines.map((line) => line + 3), fromHead: true })
    }
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={shifted} />)
    press('ArrowRight')
    const block = await screen.findByTestId('md-story-code')
    expect(asked).toEqual([HEAD])
    expect([...block.querySelectorAll<HTMLElement>('[data-key="true"]')].map((line) => Number(line.dataset.line))).toEqual([16, 17])
    expect(screen.getByTestId('story-code').textContent).toContain('The code of the PR head: the main branch no longer holds it in this form.')
  })

  it('a chapter of an Epic story reads its fragments against its own PR head', async () => {
    const asked: (string | null)[] = []
    const record: FragmentCodeSource = (fragment, head) => {
      asked.push(head)
      return storyOwnCode(fragment, head)
    }
    render(<StoryView story={epicStory()} codeOf={record} />)
    fireEvent.click(screen.getAllByTestId('story-chapter')[3]!)
    await screen.findByTestId('md-story-code')
    expect(asked).toEqual(['2130000000000000000000000000000000000000'])
  })

  it('a code that cannot be read is the story’s own, with the reason', async () => {
    render(<StoryView story={prStory('pr-en', 'en')} codeOf={() => Promise.reject(new Error('no such commit'))} />)
    press('ArrowRight')
    await screen.findByTestId('md-story-code')
    expect(screen.getByTestId('story-code').textContent).toContain('The code could not be read (no such commit): shown as the story quotes it.')
  })
})

describe('frame steps quote no fragment', () => {
  it('a frame step is shown without a code block; only "What review found and what remains" shows its own', () => {
    render(<StoryView story={prStory('pr-ru', 'ru')} codeOf={storyOwnCode} />)
    expect(shownScreen().dataset.kind).toBe('step')
    expect(screen.queryByTestId('story-code-column')).toBeNull()
    expect(shownScreen().textContent).toContain('Требование')
    fireEvent.click(segments()[3]!)
    expect(screen.queryByTestId('story-code-column')).toBeNull()
    fireEvent.click(segments()[4]!)
    expect(within(shownScreen()).getByRole('heading', { level: 2 }).textContent).toContain('Что нашёл review и что осталось')
    expect(screen.getAllByTestId('story-code')).toHaveLength(1)
  })

  it('a fragment on another frame step, which the format refuses, is not drawn either', () => {
    const story = prStory('pr-en', 'en')
    if (story.kind !== 'pr') throw new Error('a PR story')
    const code = story.steps[1]
    if (code?.kind !== 'code') throw new Error('a code step')
    const quoting = { ...story, steps: story.steps.map((step) => (step.kind === 'frame' && step.frame === 'checked' ? { ...step, fragments: [code.fragment] } : step)) }
    render(<StoryView story={quoting} codeOf={storyOwnCode} />)
    fireEvent.click(segments()[4]!)
    expect(within(shownScreen()).getByRole('heading', { level: 2 }).textContent).toContain('How it was checked')
    expect(screen.queryByTestId('story-code-column')).toBeNull()
  })
})

describe('the diagram of "Seams between tickets"', () => {
  it('draws a Ticket per number and an arrow per handoff; the dropped one red and dashed; no zoom and no pan', () => {
    render(<StoryView story={epicStory()} codeOf={storyOwnCode} />)
    fireEvent.click(screen.getAllByTestId('story-chapter')[5]!)
    const diagram = screen.getByTestId('story-seams-diagram')
    expect(within(diagram).getAllByTestId('story-seams-ticket').map((ticket) => ticket.dataset.ticket)).toEqual(['03', '04', '05'])
    const arrows = within(diagram).getAllByTestId('story-seams-arrow')
    expect(arrows.map((arrow) => `${arrow.dataset.from}→${arrow.dataset.to}:${arrow.dataset.done}`)).toEqual(['03→04:yes', '03→05:yes', '05→04:no'])
    const dropped = arrows[2]!
    expect(dropped.classList.contains('w-story-seams__arrow--dropped')).toBe(true)
    expect(dropped.getAttribute('stroke-dasharray')).toBe('6 4')
    expect(dropped.getAttribute('marker-end')).toBe('url(#w-story-arrow-dropped)')
    for (const arrow of arrows.slice(0, 2)) {
      expect(arrow.classList.contains('w-story-seams__arrow--dropped')).toBe(false)
      expect(arrow.hasAttribute('stroke-dasharray')).toBe(false)
    }
    const picture = within(diagram).getByRole('img')
    expect(picture.getAttribute('aria-label')).toMatch(/^Стыки между Ticket-ами: 03 → 04: .*; 05 → 04: скидка купона в итоге корзины \(dropped\)$/)

    // A fixed picture: no controls, no React Flow, and the wheel and a drag leave it where it is.
    const viewBox = picture.getAttribute('viewBox')
    expect(within(diagram).queryAllByRole('button')).toHaveLength(0)
    expect(diagram.querySelector('.react-flow, [class*="zoom"], [class*="pan"]')).toBeNull()
    fireEvent.wheel(picture, { deltaY: -400, ctrlKey: true })
    fireEvent.pointerDown(picture, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(picture, { clientX: 200, clientY: 90 })
    fireEvent.pointerUp(picture)
    expect(picture.getAttribute('viewBox')).toBe(viewBox)
    expect(picture.querySelector('[transform]')).toBeNull()
    // A click on the diagram does not turn the screen either.
    fireEvent.click(picture)
    expect(shownScreen().dataset.kind).toBe('seams')
  })

  it('lists each handoff in words: done, or dropped with its reason', () => {
    render(<StoryView story={epicStory()} codeOf={storyOwnCode} />)
    fireEvent.click(screen.getAllByTestId('story-chapter')[5]!)
    const items = within(shownScreen()).getAllByRole('listitem')
    expect(items.map((item) => item.dataset.done)).toEqual(['yes', 'yes', 'no'])
    // The reason is Markdown: its code spans are code, not backticks.
    expect(items[2]!.textContent).toContain('dropped — cartTotal не вызывает discountFor, итог на чеке без скидки')
    expect(items[2]!.querySelector('.w-story__handoff-dropped code')!.textContent).toBe('cartTotal')
  })

  it('draws no diagram and no list when the story has no handoffs, and keeps the text', () => {
    const story = epicStory()
    if (story.kind !== 'epic') throw new Error('the fixture is an Epic story')
    render(<StoryView story={{ ...story, seams: { ...story.seams, handoffs: [] } }} codeOf={storyOwnCode} />)
    fireEvent.click(screen.getAllByTestId('story-chapter')[5]!)
    expect(shownScreen().dataset.kind).toBe('seams')
    expect(screen.queryByTestId('story-seams-diagram')).toBeNull()
    expect(shownScreen().querySelector('svg[role="img"], ul')).toBeNull()
    expect(shownScreen().textContent).toContain('Три Ticket-а передают друг другу суммы в целых центах.')
  })
})

describe('the view in the shell: openStory, the focus and Esc', () => {
  it('openStory shows the view with the focus on it; Esc goes back to the Canvas, but not from a text field', async () => {
    render(<StoryScreen activeProjectId="p1" />)
    act(() => openStory('p1', prStory('pr-en', 'en')))
    expect(useNavigation.getState().view).toBe('story')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('story-view')))
    expect(screen.getByTestId('story-position').textContent).toContain('1 of 6')

    const field = document.createElement('input')
    document.body.append(field)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('story')
    // An arrow in a text field stays the field's.
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    expect(screen.getByTestId('story-position').textContent).toContain('1 of 6')
    field.remove()

    press('Escape')
    expect(useNavigation.getState().view).toBe('canvas')
    // Hidden, the view keeps its arrows to itself.
    press('ArrowRight')
    expect(screen.getByTestId('story-position').textContent).toContain('1 of 6')
  })

  it('a new opening starts at the first screen; another Project picked leaves the view', () => {
    const { rerender } = render(<StoryScreen activeProjectId="p1" />)
    act(() => openStory('p1', prStory('pr-en', 'en')))
    press('ArrowRight')
    expect(screen.getByTestId('story-position').textContent).toContain('2 of 6')
    act(() => openStory('p1', epicStory()))
    expect(screen.getByTestId('story-position').textContent).toContain('1 of 11')
    rerender(<StoryScreen activeProjectId="p2" />)
    expect(useNavigation.getState().view).toBe('canvas')
  })
})
