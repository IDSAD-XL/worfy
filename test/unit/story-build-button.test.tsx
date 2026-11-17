// A build of a Code story by the button runs to its end whatever view is open (worfy-polish 122, the owner's bug report
// of 2026-11-17; src/renderer/stories/StoryBuildButton.tsx, story-build.ts, use-story-toasts.ts): the button that goes
// away does not stop it; a button that comes back to its PR or Epic asks main for the build under way of its target
// (`stories.running`) and shows that build's bar — not one of another key — and ends with it (`stories.made`), even when
// the end comes before the bar is drawn; on the Canvas Esc and a switch of the view close the bar and leave the build
// running; a story nobody follows any more, or a button out of sight, waits in a toast with "Open", and a build that
// failed with nobody following it gives an error toast with its reason. main is stood in.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryMade, StoryTarget } from '../../src/shared/ipc/stories'
import { parseStory } from '../../src/shared/stories/parse'
import type { Story } from '../../src/shared/stories/schema'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  subscribe: vi.fn(),
  hasPreloadBridge: () => true,
}))
vi.mock('../../src/renderer/ipc', () => ipc)

const { StoryBuildButton } = await import('../../src/renderer/stories/StoryBuildButton')
const { useStoryToasts, MADE_STORY_TOAST_TEST_ID, MADE_STORY_FAILED_TEST_ID } = await import('../../src/renderer/stories/use-story-toasts')
const { setView, useNavigation } = await import('../../src/renderer/session/navigation')
const { toasts } = await import('../../src/renderer/toast/toasts')
const { useStoryView } = await import('../../src/renderer/stories/open')

const FIXTURES = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'tests', 'fixtures', 'code-story')

/** A story made by the button: the fixture PR story with the head it was made from. */
function madeStory(): Story {
  const parsed = parseStory(readFileSync(join(FIXTURES, 'pr-en.md'), 'utf8'), { committed: true })
  if (!parsed.ok || parsed.story.kind !== 'pr') throw new Error('pr-en is a PR story')
  return { ...parsed.story, header: { ...parsed.story.header, commit: 'c'.repeat(40) } } as Story
}

const PR_A: StoryTarget = { kind: 'pr', repo: 'shop/demo-cart', number: 212 }
const PR_B: StoryTarget = { kind: 'pr', repo: 'shop/demo-cart', number: 213 }
const KEY_A = 'shop/demo-cart#212'

type Listener = (payload: unknown) => void
let listeners: Map<string, Set<Listener>>
/** main's builds under way, by `<repo>#<number>` of the target asked. */
let underWay: Map<string, { storyId: string; key: string; lines: string[] }>

const targetKey = (target: StoryTarget): string => (target.kind === 'pr' ? `${target.repo ?? ''}#${String(target.number)}` : `epic:${target.epic}`)

beforeEach(() => {
  listeners = new Map()
  underWay = new Map()
  ipc.subscribe.mockReset()
  ipc.subscribe.mockImplementation((channel: string, handler: Listener) => {
    const set = listeners.get(channel) ?? new Set<Listener>()
    set.add(handler)
    listeners.set(channel, set)
    return () => set.delete(handler)
  })
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation((channel: string, input: { target?: StoryTarget }) => {
    switch (channel) {
      case 'stories.running':
        return Promise.resolve({ ok: true, value: underWay.get(targetKey(input.target!)) ?? null })
      case 'stories.make':
        return new Promise(() => undefined)
      case 'stories.saved':
        return Promise.resolve({ ok: true, value: null })
      default:
        return Promise.resolve({ ok: true, value: { stopped: true } })
    }
  })
  toasts.setState({ toasts: [] })
  setView('canvas')
})

afterEach(cleanup)

/** Sends event `channel` to the window, as main does. */
const tell = (channel: string, payload: unknown) =>
  act(() => {
    for (const listener of listeners.get(channel) ?? []) listener(payload)
  })

const calls = (channel: string) => ipc.invoke.mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload as Record<string, unknown>)

const lines = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

function PrButton({ target }: { target: StoryTarget }) {
  return <StoryBuildButton projectId="p1" target={target} title="Build the Code story of this pull request" testId="pr-inbox-code-story" className="w-pr-inbox-button" savedKey={targetKey(target)} />
}

const made = (story: Story): StoryMade => ({ key: KEY_A, reused: false, outcome: { status: 'story', story } })

/** The app's window: its toasts of the stories made by the button (useStoryToasts), around `children`. */
function Window({ children }: { children?: React.ReactNode }) {
  useStoryToasts(undefined)
  return <>{children}</>
}

/** The toasts with `testId` shown now. */
const toastsOf = (testId: string) => toasts.getState().toasts.filter((toast) => toast.testId === testId)
const shown = () => toastsOf(MADE_STORY_TOAST_TEST_ID)

describe('the button goes away while its story builds', () => {
  it('does not stop the build: no stories.stop, the build is main\'s to finish', async () => {
    const { unmount } = render(<PrButton target={PR_A} />)
    fireEvent.click(await screen.findByTestId('pr-inbox-code-story'))
    expect(calls('stories.make')).toHaveLength(1)
    expect(screen.getByTestId('pr-inbox-code-story-progress')).toBeTruthy()
    unmount()
    expect(calls('stories.stop')).toEqual([])
  })
})

describe('a button that comes back to its PR', () => {
  it('shows the bar of the build under way of its own target, with main\'s last lines, and opens the story when the build ends', async () => {
    underWay.set(targetKey(PR_A), { storyId: 's-a', key: KEY_A, lines: ['Read src/cart.ts', 'Grep cartTotal'] })
    render(<PrButton target={PR_A} />)
    expect(await screen.findByTestId('pr-inbox-code-story-progress')).toBeTruthy()
    expect(calls('stories.running')).toEqual([{ projectId: 'p1', target: PR_A }])
    expect(lines('story-progress-lines')).toEqual(['Read src/cart.ts', 'Grep cartTotal'])
    tell('stories.activity', { storyId: 's-a', text: 'Read src/money.ts' })
    expect(lines('story-progress-lines')).toEqual(['Read src/cart.ts', 'Grep cartTotal', 'Read src/money.ts'])
    // No second request: the button follows the build, it does not press again.
    expect(calls('stories.make')).toEqual([])
    const story = madeStory()
    tell('stories.made', { storyId: 's-a', projectId: 'p1', made: made(story) })
    await vi.waitFor(() => expect(useNavigation.getState().view).toBe('story'))
    expect(useStoryView.getState().story).toBe(story)
    expect(screen.queryByTestId('pr-inbox-code-story-progress')).toBeNull()
  })

  it('a build of another key is not shown: the button of PR B stays a button, and lines of A do not reach it', async () => {
    underWay.set(targetKey(PR_A), { storyId: 's-other', key: KEY_A, lines: ['Read src/cart.ts'] })
    render(
      <Window>
        <PrButton target={PR_B} />
      </Window>,
    )
    await vi.waitFor(() => expect(calls('stories.running')).toEqual([{ projectId: 'p1', target: PR_B }]))
    await act(async () => {
      await Promise.resolve()
    })
    tell('stories.activity', { storyId: 's-other', text: 'Grep cartTotal' })
    expect(screen.queryByTestId('pr-inbox-code-story-progress')).toBeNull()
    expect(screen.getByTestId('pr-inbox-code-story').getAttribute('aria-disabled')).toBe('false')
    // A ends: B's button opens nothing, and the window's toast says A's story is ready.
    tell('stories.made', { storyId: 's-other', projectId: 'p1', made: made(madeStory()) })
    await vi.waitFor(() => expect(shown().map((toast) => toast.text)).toEqual([`The Code story of PR ${KEY_A} is ready`]))
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('the build ends right after main named it, before the bar is drawn: the end is not missed', async () => {
    let answerRunning: (value: unknown) => void = () => undefined
    ipc.invoke.mockImplementation((channel: string) => {
      if (channel === 'stories.running') return new Promise((resolve) => (answerRunning = resolve))
      return Promise.resolve({ ok: true, value: null })
    })
    render(<PrButton target={PR_A} />)
    await vi.waitFor(() => expect(calls('stories.running')).toHaveLength(1))
    const story = madeStory()
    // In one act: main's answer, the hook takes the build, and the end comes before React draws the bar and runs its effects.
    await act(async () => {
      answerRunning({ ok: true, value: { storyId: 's-a', key: KEY_A, lines: [] } })
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
      for (const listener of listeners.get('stories.made') ?? []) listener({ storyId: 's-a', projectId: 'p1', made: made(story) })
    })
    await vi.waitFor(() => expect(useNavigation.getState().view).toBe('story'))
    expect(screen.queryByTestId('pr-inbox-code-story-progress')).toBeNull()
  })

  it('out of sight — its view hidden — the button gives the toast instead of opening the story over the screen', async () => {
    underWay.set(targetKey(PR_A), { storyId: 's-a', key: KEY_A, lines: [] })
    render(
      <Window>
        <div className="w-shell__view" data-view="pull-requests" hidden>
          <PrButton target={PR_A} />
        </div>
      </Window>,
    )
    await screen.findByTestId('pr-inbox-code-story-progress')
    tell('stories.made', { storyId: 's-a', projectId: 'p1', made: made(madeStory()) })
    await vi.waitFor(() => expect(shown()).toHaveLength(1))
    expect(useNavigation.getState().view).toBe('canvas')
  })
})

describe('on the Canvas the bar closes and the build goes on', () => {
  function EpicButton() {
    return (
      <div className="w-shell__view" data-view="canvas">
        <StoryBuildButton projectId="p1" target={{ kind: 'epic', epic: 'demo-cart' }} title="Build" testId="action-epic-story" className="w-action" floating />
      </div>
    )
  }

  it('Esc in the bar closes it without Stop; a press of the button shows it again', async () => {
    render(<EpicButton />)
    const button = await screen.findByTestId('action-epic-story')
    fireEvent.click(button)
    const bar = await screen.findByTestId('action-epic-story-progress')
    fireEvent.keyDown(bar, { key: 'Escape' })
    await vi.waitFor(() => expect(screen.queryByTestId('action-epic-story-progress')).toBeNull())
    expect(calls('stories.stop')).toEqual([])
    expect(button.getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(button)
    expect(await screen.findByTestId('action-epic-story-progress')).toBeTruthy()
    expect(calls('stories.make')).toHaveLength(1)
  })

  it('a button nobody pressed takes up the build of its Epic started elsewhere, and shows its bar over the Canvas', async () => {
    underWay.set('epic:demo-cart', { storyId: 's-epic', key: 'epic:demo-cart', lines: ['Read demo-cart/spec.md'] })
    render(<EpicButton />)
    const bar = await screen.findByTestId('action-epic-story-progress')
    expect(lines('story-progress-lines')).toEqual(['Read demo-cart/spec.md'])
    expect(within(bar).getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(calls('stories.running')).toEqual([{ projectId: 'p1', target: { kind: 'epic', epic: 'demo-cart' } }])
    expect(calls('stories.make')).toEqual([])
  })

  it('a switch of the view closes it without Stop; the Canvas shown again shows it again', async () => {
    render(<EpicButton />)
    fireEvent.click(await screen.findByTestId('action-epic-story'))
    await screen.findByTestId('action-epic-story-progress')
    const canvas = document.querySelector('.w-shell__view')!
    act(() => {
      canvas.setAttribute('hidden', '')
      setView('pull-requests')
    })
    await vi.waitFor(() => expect(screen.queryByTestId('action-epic-story-progress')).toBeNull())
    expect(calls('stories.stop')).toEqual([])
    act(() => {
      canvas.removeAttribute('hidden')
      setView('canvas')
    })
    expect(await screen.findByTestId('action-epic-story-progress')).toBeTruthy()
    expect(calls('stories.make')).toHaveLength(1)
  })
})

describe('the toast of a story nobody follows any more', () => {

  it('a build that ends with no button following it: "The Code story of PR … is ready" with Open, which opens the story', async () => {
    render(<Window />)
    const story = madeStory()
    tell('stories.made', { storyId: 'gone', projectId: 'p1', made: made(story) })
    await vi.waitFor(() => expect(shown()).toHaveLength(1))
    const toast = shown()[0]!
    expect(toast.text).toBe(`The Code story of PR ${KEY_A} is ready`)
    expect(toast.actions?.map((action) => action.label)).toEqual(['Open'])
    toast.actions![0]!.run()
    expect(useNavigation.getState().view).toBe('story')
    expect(useStoryView.getState().story).toBe(story)
  })

  it('a build its button follows opens the story there and gives no toast; a stopped or reused one gives none either', async () => {
    underWay.set(targetKey(PR_A), { storyId: 's-a', key: KEY_A, lines: [] })
    render(
      <Window>
        <PrButton target={PR_A} />
      </Window>,
    )
    await screen.findByTestId('pr-inbox-code-story-progress')
    tell('stories.made', { storyId: 's-a', projectId: 'p1', made: made(madeStory()) })
    await vi.waitFor(() => expect(useNavigation.getState().view).toBe('story'))
    tell('stories.made', { storyId: 'other', projectId: 'p1', made: { key: KEY_A, reused: false, outcome: { status: 'stopped' } } })
    tell('stories.made', { storyId: 'kept', projectId: 'p1', made: { ...made(madeStory()), reused: true } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(shown()).toEqual([])
    expect(toastsOf(MADE_STORY_FAILED_TEST_ID)).toEqual([])
  })

  it('a build that fails, or is not available, with no button following it: an error toast with the reason', async () => {
    render(<Window />)
    tell('stories.made', { storyId: 'gone-1', projectId: 'p1', made: { key: KEY_A, reused: false, outcome: { status: 'failed', reason: 'PR #212 changes nothing: its diff is empty.' } } })
    tell('stories.made', { storyId: 'gone-2', projectId: 'p1', made: { key: 'epic:demo-cart', reused: false, outcome: { status: 'unavailable', reason: 'Codex has no oneShot.' } } })
    await vi.waitFor(() => expect(toastsOf(MADE_STORY_FAILED_TEST_ID)).toHaveLength(2))
    expect(toastsOf(MADE_STORY_FAILED_TEST_ID).map((toast) => [toast.kind, toast.text])).toEqual([
      ['error', `The Code story of PR ${KEY_A} failed: PR #212 changes nothing: its diff is empty.`],
      ['error', 'The Code story of Epic demo-cart is not available: Codex has no oneShot.'],
    ])
    expect(shown()).toEqual([])
  })

  it('a build that fails while its button follows it: the bar says why, and no toast', async () => {
    underWay.set(targetKey(PR_A), { storyId: 's-a', key: KEY_A, lines: [] })
    render(
      <Window>
        <PrButton target={PR_A} />
      </Window>,
    )
    await screen.findByTestId('pr-inbox-code-story-progress')
    tell('stories.made', { storyId: 's-a', projectId: 'p1', made: { key: KEY_A, reused: false, outcome: { status: 'failed', reason: 'gh is not signed in' } } })
    await vi.waitFor(() => expect(screen.getByTestId('story-progress-reason').textContent).toContain('gh is not signed in'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(toastsOf(MADE_STORY_FAILED_TEST_ID)).toEqual([])
  })
})
