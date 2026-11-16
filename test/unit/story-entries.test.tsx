// The entries into the Story view (worfy-code-stories ticket 10): "Code story" on an Epic frame and on a Ticket card
// (src/renderer/canvas/actions/EpicStory.tsx, TicketStory.tsx), and the opening of a story file they share
// (openStoryFile of src/renderer/stories/open.ts): main reads the file (`stories.read`), the view shows it, and the code
// of each fragment is asked of main (`stories.code`) where the story is anchored. Ticket 11: without a story file the
// button builds the story by the button (`stories.make`): the Epic's so far, or that of the Ticket's PR; the progress bar
// takes its place, and the Story view opens on the story main kept, its code asked at the PR head the story names. A
// done Ticket that names no PR has the button inactive with the reason; a Project on Codex shows the reason of its
// capabilities.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import { parseStory } from '../../src/shared/stories/parse'
import type { StoryFile } from '../../src/shared/stories/schema'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const ROOT = '/Users/test/projects/demo-cart'
const PROJECT = 'demo-cart-0000000a'
const FIXTURES = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'tests', 'fixtures', 'code-story')

/** A fixture story as stories.read gives it: parsed as a committed file. */
function storyOf(name: string): StoryFile {
  const parsed = parseStory(readFileSync(join(FIXTURES, `${name}.md`), 'utf8'), { committed: true })
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.story
}

const ticket = (num: number, state: Ticket['state'], over: Partial<Ticket> = {}): Ticket => ({
  epic: 'demo-cart',
  num,
  slug: `ticket-${num}`,
  title: `Ticket ${num}`,
  statusRaw: state,
  state,
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  ...over,
})

const WITH_STORIES: Epic = {
  epic: 'demo-cart',
  hasSpec: true,
  hasMap: false,
  title: 'Demo cart',
  stories: [
    { kind: 'epic', path: 'demo-cart/story.md', ticket: null, version: 'a1' },
    { kind: 'pr', path: 'demo-cart/stories/04-cart-total.md', ticket: '04', version: 'b2' },
  ],
}
const WITHOUT_STORIES: Epic = { epic: 'demo-cart', hasSpec: true, hasMap: false, title: 'Demo cart' }

let epic: Epic
let tickets: Ticket[]
let calls: { channel: string; input: unknown }[]
let readAnswer: IpcResult<unknown>
/** main's answer to stories.make; pending until a test answers it. */
let makeAnswer: (input: unknown) => Promise<IpcResult<unknown>>

beforeEach(() => {
  vi.resetModules()
  calls = []
  epic = WITH_STORIES
  tickets = [ticket(4, 'done', { pr: 212 }), ticket(5, 'done', { pr: 213 }), ticket(6, 'open'), ticket(7, 'done')]
  readAnswer = { ok: true, value: { ok: true, story: storyOf('pr-en'), path: 'demo-cart/stories/04-cart-total.md', dir: '.scratch/demo-cart/stories' } }
  makeAnswer = () => new Promise(() => undefined)
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      calls.push({ channel, input })
      const model: WorkflowModel = { root: ROOT, epics: [epic], tickets, error: null, branchErrors: [] }
      switch (channel) {
        case 'workflow.open':
          return Promise.resolve({ ok: true, value: model })
        case 'projects.list':
          return Promise.resolve({ ok: true, value: { projects: [{ id: PROJECT, name: 'demo-cart', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 } })
        case 'stories.read':
          return Promise.resolve(readAnswer)
        case 'stories.make':
          return makeAnswer(input)
        case 'stories.stop':
          return Promise.resolve({ ok: true, value: { stopped: true } })
        case 'stories.code':
          return Promise.resolve({ ok: true, value: { code: 'const total = 0', startLine: 3, keyLines: [3], fromHead: true, reason: 'no-anchor' } })
        default:
          return Promise.resolve({ ok: false, error: `no ${channel} in this test` })
      }
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const epicSubject = () => ({ kind: 'epic' as const, projectId: PROJECT, root: ROOT, epic, tickets })
const ticketSubject = (num: number) => ({ kind: 'ticket' as const, projectId: PROJECT, root: ROOT, ticket: tickets.find((each) => each.num === num)! })

async function epicButton(): Promise<HTMLElement> {
  const { default: EpicStory } = await import('../../src/renderer/canvas/actions/EpicStory')
  render(<EpicStory subject={epicSubject()} />)
  return screen.findByTestId('action-epic-story')
}

async function ticketButton(num: number): Promise<HTMLElement | null> {
  const { default: TicketStory } = await import('../../src/renderer/canvas/actions/TicketStory')
  render(<TicketStory subject={ticketSubject(num)} />)
  // The model comes from workflow.open; the button decides after it.
  await vi.waitFor(() => expect(calls.some((call) => call.channel === 'workflow.open')).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return screen.queryByTestId('action-ticket-story')
}

/** A story made by the button, with the PR head it was made from (a Story, not a committed file). */
const madeStory = (): StoryFile => {
  const story = storyOf('pr-en')
  if (story.kind !== 'pr') throw new Error('pr-en is a PR story')
  return { ...story, header: { ...story.header, commit: 'c'.repeat(40) } }
}

describe('"Code story" on an Epic frame', () => {
  it('without story.md builds the story so far: stories.make of the Epic, the bar in its place, then the Story view', async () => {
    epic = WITHOUT_STORIES
    let answer: (value: IpcResult<unknown>) => void = () => undefined
    makeAnswer = () => new Promise((resolve) => (answer = resolve))
    const button = await epicButton()
    expect(button.textContent).toBe('Code story')
    expect(button.getAttribute('aria-disabled')).toBe('false')
    expect(button.getAttribute('title')).toBe('Build the Code story of demo-cart so far, from the stories of its merged PRs')
    fireEvent.click(button)
    expect(calls.filter((call) => call.channel === 'stories.read')).toEqual([])
    const made = calls.filter((call) => call.channel === 'stories.make').map((call) => call.input as { projectId: string; target: unknown; storyId: string })
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ projectId: PROJECT, target: { kind: 'epic', epic: 'demo-cart' } })
    // The bar is drawn into document.body under the button, out of the frame that would cut it; the button stays, inactive.
    const bar = await screen.findByTestId('action-epic-story-progress')
    expect(button.parentElement!.contains(bar)).toBe(false)
    expect(bar.closest('[data-kit-in-node]')).not.toBeNull()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(calls.filter((call) => call.channel === 'stories.make')).toHaveLength(1)
    answer({ ok: true, value: { key: 'epic:demo-cart', reused: false, outcome: { status: 'story', story: madeStory() } } })
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    await vi.waitFor(() => expect(useNavigation.getState().view).toBe('story'))
    expect(await screen.findByTestId('action-epic-story')).toBeTruthy()
    // The code of a fragment is asked at the PR head the story names.
    const { useStoryView } = await import('../../src/renderer/stories/open')
    const shown = useStoryView.getState()
    expect(shown.storyDir).toBeUndefined()
    const story = shown.story!
    const step = story.kind === 'pr' ? story.steps.find((one) => one.kind === 'code') : undefined
    if (step?.kind !== 'code') throw new Error('no code step')
    await shown.codeOf(step.fragment, 'c'.repeat(40), 212)
    expect(calls.filter((call) => call.channel === 'stories.code').map((call) => (call.input as { at: unknown }).at)).toEqual([{ commit: 'c'.repeat(40) }])
  })

  it('a PR story alone does not open: only the Epic\'s story.md does; without it the button builds', async () => {
    epic = { ...WITH_STORIES, stories: [WITH_STORIES.stories![1]!] }
    const button = await epicButton()
    fireEvent.click(button)
    expect(calls.filter((call) => call.channel === 'stories.read')).toEqual([])
    expect(calls.filter((call) => call.channel === 'stories.make')).toHaveLength(1)
  })

  it('a Project on Codex: the reason of its capabilities in the bar, and one ask of main only', async () => {
    epic = WITHOUT_STORIES
    const reason = 'One-off requests (the Project profile draft, Terminal AI, a Code story) run on Claude Code only.'
    makeAnswer = () => Promise.resolve({ ok: true, value: { key: 'epic:demo-cart', reused: false, outcome: { status: 'unavailable', reason } } })
    fireEvent.click(await epicButton())
    expect((await screen.findByTestId('story-progress-reason')).textContent).toBe(reason)
    expect(screen.getByTestId('story-progress').dataset.state).toBe('unavailable')
    expect(screen.getByTestId('story-progress').textContent).toContain('Not available')
    expect(calls.filter((call) => call.channel === 'stories.make')).toHaveLength(1)
    // Close: the bar goes and the focus is back on the button.
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.click(close)
    await vi.waitFor(() => expect(screen.queryByTestId('action-epic-story-progress')).toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('action-epic-story')))
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('with story.md opens it: stories.read of the file, then the Story view', async () => {
    readAnswer = { ok: true, value: { ok: true, story: storyOf('epic-ru'), path: 'demo-cart/story.md', dir: '.scratch/demo-cart' } }
    const button = await epicButton()
    expect(button.getAttribute('aria-disabled')).toBe('false')
    expect(button.getAttribute('title')).toBe('Open the Code story of demo-cart')
    fireEvent.click(button)
    const { useStoryView } = await import('../../src/renderer/stories/open')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    await vi.waitFor(() => expect(useNavigation.getState().view).toBe('story'))
    expect(calls.filter((call) => call.channel === 'stories.read').map((call) => call.input)).toEqual([{ projectId: PROJECT, path: 'demo-cart/story.md' }])
    const shown = useStoryView.getState()
    expect(shown.projectId).toBe(PROJECT)
    expect(shown.story?.kind).toBe('epic')
    expect(shown.storyDir).toBe('.scratch/demo-cart')
  })

  it('a story main cannot read keeps the Canvas and shows the reason on the button', async () => {
    readAnswer = { ok: true, value: { ok: false, reason: 'demo-cart/story.md: no section "Начало"' } }
    const button = await epicButton()
    fireEvent.click(button)
    await vi.waitFor(() => expect(button.getAttribute('data-error')).toBe('demo-cart/story.md: no section "Начало"'))
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    expect(useNavigation.getState().view).toBe('canvas')
  })
})

describe('"Code story" on a Ticket card', () => {
  it('with the story of its PR opens it', async () => {
    const button = await ticketButton(4)
    expect(button?.getAttribute('aria-disabled')).toBe('false')
    expect(button?.getAttribute('title')).toBe('Open the Code story of the PR of demo-cart/04')
    fireEvent.click(button!)
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    await vi.waitFor(() => expect(useNavigation.getState().view).toBe('story'))
    expect(calls.filter((call) => call.channel === 'stories.read').map((call) => call.input)).toEqual([{ projectId: PROJECT, path: 'demo-cart/stories/04-cart-total.md' }])
  })

  it("a Ticket with a PR and no story of it builds the PR's story: stories.make of its PR in the Project's repository", async () => {
    const button = await ticketButton(5)
    expect(button?.getAttribute('aria-disabled')).toBe('false')
    expect(button?.getAttribute('title')).toBe('Build the Code story of PR #213 of demo-cart/05: it has no story file')
    fireEvent.click(button!)
    expect(calls.filter((call) => call.channel === 'stories.make').map((call) => (call.input as { target: unknown }).target)).toEqual([{ kind: 'pr', repo: null, number: 213 }])
    // Out of the card (240px wide, `overflow: hidden`): drawn into document.body.
    const bar = await screen.findByTestId('action-ticket-story-progress')
    expect(button!.parentElement!.contains(bar)).toBe(false)
  })

  it("a Ticket over several repositories: its PR is built in the repository its `PR: <repo>#N` line names", async () => {
    tickets = [ticket(5, 'done', { pr: 7, repos: ['lib', 'app'], prs: [{ repo: 'lib', number: 31 }, { repo: 'app', number: 7 }] } as Partial<Ticket>)]
    const button = await ticketButton(5)
    expect(button?.getAttribute('title')).toBe('Build the Code story of PR app#7 of demo-cart/05: it has no story file')
    fireEvent.click(button!)
    expect(calls.filter((call) => call.channel === 'stories.make').map((call) => (call.input as { target: unknown }).target)).toEqual([{ kind: 'pr', repo: 'app', number: 7 }])
  })

  it('a done Ticket with no PR line and no story is inactive, with the reason', async () => {
    const button = await ticketButton(7)
    expect(button?.textContent).toBe('Code story')
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    expect(button?.getAttribute('title')).toBe('No Code story of demo-cart/07: the Ticket names no PR to build one from')
  })

  it('a Ticket with no PR and no story has no button', async () => {
    expect(await ticketButton(6)).toBeNull()
  })
})

describe('"Open" of the toast of an Epic story', () => {
  it('a story main cannot read shows its reason in an error toast; one it reads opens the view', async () => {
    const { openEpicStoryOf } = await import('../../src/renderer/stories/use-story-toasts')
    const { resetToasts, toasts } = await import('../../src/renderer/toast/toasts')
    resetToasts()
    readAnswer = { ok: true, value: { ok: false, reason: 'demo-cart/story.md: no section "Начало"' } }
    await openEpicStoryOf(PROJECT, 'demo-cart', () => [epic])
    expect(calls.filter((call) => call.channel === 'stories.read').map((call) => call.input)).toEqual([{ projectId: PROJECT, path: 'demo-cart/story.md' }])
    expect(toasts.getState().toasts.map((toast) => [toast.kind, toast.text])).toEqual([['error', 'The Code story of Epic demo-cart cannot be opened: demo-cart/story.md: no section "Начало"']])
    resetToasts()
    readAnswer = { ok: true, value: { ok: true, story: storyOf('epic-ru'), path: 'demo-cart/story.md', dir: '.scratch/demo-cart' } }
    await openEpicStoryOf(PROJECT, 'demo-cart', () => [epic])
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    expect(useNavigation.getState().view).toBe('story')
    expect(toasts.getState().toasts).toEqual([])
  })
})

describe('the code of a fragment, asked of main where the story is anchored', () => {
  it('a committed story: its file and the PR of its header or chapter; a story with a head: that commit; the reason comes along', async () => {
    const { storyCodeSource } = await import('../../src/renderer/stories/open')
    const story = storyOf('pr-en')
    const fragment = story.kind === 'pr' ? story.steps.flatMap((step) => (step.kind === 'code' ? [step.fragment] : []))[0]! : null!
    const codeOf = storyCodeSource(PROJECT, 'demo-cart/stories/04-cart-total.md')
    await expect(codeOf(fragment, null, 212)).resolves.toMatchObject({ code: 'const total = 0', fromHead: true, reason: 'no-anchor' })
    await codeOf(fragment, null, null)
    await codeOf(fragment, 'c'.repeat(40), 212)
    expect(calls.filter((call) => call.channel === 'stories.code').map((call) => (call.input as { at: unknown }).at)).toEqual([
      { path: 'demo-cart/stories/04-cart-total.md', pr: 212 },
      { path: 'demo-cart/stories/04-cart-total.md', pr: null },
      { commit: 'c'.repeat(40) },
    ])
  })
})
