// The progress bar of a Code story (worfy-code-stories ticket 04, src/renderer/stories/StoryProgress.tsx):
// the agent's lines in their order while it runs, Stop, and in the same place why no story came — Stop, a
// failure, or a Project whose Vendor has no oneShot (the reason of its capabilities). main is stood in.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryInput, StoryOutcome } from '../../src/shared/ipc/stories'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  subscribe: vi.fn(),
  hasPreloadBridge: () => false,
}))
vi.mock('../../src/renderer/ipc', () => ipc)

const { StoryProgress } = await import('../../src/renderer/stories/StoryProgress')
const { useStoryBuild, STARTING_LINE } = await import('../../src/renderer/stories/story-build')

/** The reason main answers for a Codex Project: the Codex capabilities' own (test/contract/story-one-shot.test.ts checks it is). */
const CODEX_REASON = 'One-off requests (the Project profile draft, Terminal AI, a Code story) run on Claude Code only.'

const INPUT: StoryInput = {
  header: { kind: 'pr', epic: 'worfy-example', ticket: '07', pr: 4321, language: 'en' },
  diff: 'diff --git a/x b/x\n',
  prText: 'Fix x',
  ticket: null,
  verdicts: [],
}

/** A button and its progress bar, as tickets 11 and 12 hold them. */
function StoryButton({ projectId }: { projectId: string }) {
  const { run, start, stop, reset } = useStoryBuild(projectId)
  if (run.kind === 'idle') {
    return (
      <button type="button" onClick={() => void start(INPUT)}>
        Story
      </button>
    )
  }
  if (run.kind === 'done') return <p>{run.story.steps[0]?.title}</p>
  return <StoryProgress run={run} onStop={stop} onDismiss={reset} />
}

let listeners: ((payload: { storyId: string; text: string }) => void)[]
let answer: (result: { ok: true; value: StoryOutcome } | { ok: false; error: string }) => void

beforeEach(() => {
  listeners = []
  ipc.subscribe.mockReset()
  ipc.subscribe.mockImplementation((channel: string, handler: (payload: { storyId: string; text: string }) => void) => {
    if (channel === 'stories.activity') listeners.push(handler)
    return () => {
      listeners = listeners.filter((listener) => listener !== handler)
    }
  })
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation((channel: string) => {
    if (channel === 'stories.build') return new Promise((resolve) => (answer = resolve))
    return Promise.resolve({ ok: true, value: { stopped: true } })
  })
})

afterEach(cleanup)

/** Presses "Story" and answers the storyId main was asked for. */
function press(): string {
  render(<StoryButton projectId="p1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Story' }))
  const call = ipc.invoke.mock.calls.find(([channel]) => channel === 'stories.build') as [string, { storyId: string; projectId: string; input: StoryInput }]
  expect(call[1]).toMatchObject({ projectId: 'p1', input: INPUT })
  return call[1].storyId
}

const tell = (storyId: string, text: string) =>
  act(() => {
    for (const listener of listeners) listener({ storyId, text })
  })

const lines = () => within(screen.getByTestId('story-progress-lines')).getAllByRole('listitem').map((item) => item.textContent)

describe('while the story is built', () => {
  it('the bar stands where the button was and shows the agent’s lines in their order, the last three', () => {
    const storyId = press()
    expect(screen.queryByRole('button', { name: 'Story' })).toBeNull()
    expect(screen.getByRole('progressbar', { name: 'Building the Code story' })).toBeTruthy()
    expect(lines()).toEqual([STARTING_LINE])
    tell(storyId, 'Claude Code started')
    tell(storyId, 'Grep statusLine')
    expect(lines()).toEqual(['Claude Code started', 'Grep statusLine'])
    tell(storyId, 'Read src/status.ts')
    tell(storyId, 'Read src/status.test.ts')
    expect(lines()).toEqual(['Grep statusLine', 'Read src/status.ts', 'Read src/status.test.ts'])
  })

  it('a line of another build is not shown', () => {
    const storyId = press()
    tell(storyId, 'Grep statusLine')
    tell('another', 'Read secret.ts')
    expect(lines()).toEqual(['Grep statusLine'])
  })

  it('a story that came back takes the bar away', async () => {
    press()
    await act(async () => {
      answer({ ok: true, value: { status: 'story', story: { header: INPUT.header, steps: [{ title: 'The first step', fragment: null, what: 'a', why: 'b', without: 'c', requirement: 'd', risks: 'e' }], handoffs: [] } } })
      await Promise.resolve()
    })
    expect(screen.queryByTestId('story-progress')).toBeNull()
    expect(screen.getByText('The first step')).toBeTruthy()
  })
})

describe('Stop and failures, in the place of the button', () => {
  it('Stop asks main to end this build, then shows that it stopped and wrote nothing', async () => {
    const storyId = press()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(ipc.invoke).toHaveBeenCalledWith('stories.stop', { storyId })
    expect(screen.getByText('Stopping…')).toBeTruthy()
    // A second press while it stops asks nothing more.
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(ipc.invoke.mock.calls.filter(([channel]) => channel === 'stories.stop')).toHaveLength(1)
    await act(async () => {
      answer({ ok: true, value: { status: 'stopped' } })
      await Promise.resolve()
    })
    const bar = screen.getByTestId('story-progress')
    expect(bar.dataset.state).toBe('stopped')
    expect(within(bar).getByText('Stopped')).toBeTruthy()
    expect(within(bar).getByTestId('story-progress-reason').textContent).toBe('No story was written.')
    fireEvent.click(within(bar).getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Story' })).toBeTruthy()
  })

  it('a failure shows its reason', async () => {
    press()
    await act(async () => {
      answer({ ok: true, value: { status: 'failed', reason: "The answer does not fit the story's schema: steps.0.risks: Too small" } })
      await Promise.resolve()
    })
    const bar = screen.getByRole('alert')
    expect(bar.dataset.state).toBe('failed')
    expect(within(bar).getByText('Failed')).toBeTruthy()
    expect(within(bar).getByTestId('story-progress-reason').textContent).toBe("The answer does not fit the story's schema: steps.0.risks: Too small")
  })

  it('a call main refused shows the handler’s reason without the channel’s name', async () => {
    press()
    await act(async () => {
      answer({ ok: false, error: 'stories.build failed: No Project with id p1' })
      await Promise.resolve()
    })
    expect(screen.getByTestId('story-progress-reason').textContent).toBe('No Project with id p1')
  })
})

describe('a Project on Codex', () => {
  it('shows the reason of the Codex capabilities, not a silent failure', async () => {
    press()
    await act(async () => {
      answer({ ok: true, value: { status: 'unavailable', reason: CODEX_REASON } })
      await Promise.resolve()
    })
    const bar = screen.getByRole('alert')
    expect(bar.dataset.state).toBe('unavailable')
    expect(within(bar).getByText('Not available')).toBeTruthy()
    expect(within(bar).getByTestId('story-progress-reason').textContent).toBe(CODEX_REASON)
  })
})
