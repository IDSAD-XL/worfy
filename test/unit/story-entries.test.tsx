// The entries into the Story view (worfy-code-stories ticket 10): "Code story" on an Epic frame and on a Ticket card
// (src/renderer/canvas/actions/EpicStory.tsx, TicketStory.tsx), and the opening of a story file they share
// (openStoryFile of src/renderer/stories/open.ts): main reads the file (`stories.read`), the view shows it, and the code
// of each fragment is asked of main (`stories.code`) where the story is anchored. Without a story the button is
// inactive and its tooltip says why.
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

beforeEach(() => {
  vi.resetModules()
  calls = []
  epic = WITH_STORIES
  tickets = [ticket(4, 'done', { pr: 212 }), ticket(5, 'done', { pr: 213 }), ticket(6, 'open'), ticket(7, 'done')]
  readAnswer = { ok: true, value: { ok: true, story: storyOf('pr-en'), path: 'demo-cart/stories/04-cart-total.md', dir: '.scratch/demo-cart/stories' } }
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

describe('"Code story" on an Epic frame', () => {
  it('without story.md is inactive, and its tooltip says the story comes with the last PR of the Epic', async () => {
    epic = WITHOUT_STORIES
    const button = await epicButton()
    expect(button.textContent).toBe('Code story')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('title')).toBe('No Code story of demo-cart yet: it is written when the last PR of the Epic is merged')
    fireEvent.click(button)
    expect(calls.filter((call) => call.channel === 'stories.read')).toEqual([])
  })

  it('a PR story alone does not make it active: only the Epic\'s story.md does', async () => {
    epic = { ...WITH_STORIES, stories: [WITH_STORIES.stories![1]!] }
    const button = await epicButton()
    expect(button.getAttribute('aria-disabled')).toBe('true')
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

  it('a Ticket with a PR and no story of it is inactive, with the reason', async () => {
    const button = await ticketButton(5)
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    expect(button?.getAttribute('title')).toBe('No Code story of the PR of demo-cart/05: the implementer writes stories/05-<slug>.md with the PR')
  })

  it('a done Ticket with no PR line and no story is inactive, with the reason', async () => {
    const button = await ticketButton(7)
    expect(button?.textContent).toBe('Code story')
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    expect(button?.getAttribute('title')).toBe('No Code story of the PR of demo-cart/07: the implementer writes stories/07-<slug>.md with the PR')
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
