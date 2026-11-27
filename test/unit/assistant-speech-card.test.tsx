// The Assistant's speech card closes as a whole (worfy-polish 161; the owner's report: the card could not be closed
// without clicking through all 56 items). Close, or Escape, closes the card: every item it would tell of counts as told by it (`assistant.cardClosed`), and
// the card speaks again only of what comes after; the items stay in the list and on the icon. Before the first Close a
// backlog is one line, never its oldest item. The card component and the section's store are real; main is a fake that
// keeps what the card told of as main does (test/unit/assistant-window.test.ts checks main's own file and its rules).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantView, WindowItem } from '../../src/shared/assistant/window'
import { defaultAppSettings } from '../../src/shared/settings/app-settings'

const main = vi.hoisted(() => ({
  items: [] as WindowItem[],
  /** What the card told of: the item's count of events the card showed when it was closed over it. */
  told: new Map<string, number>(),
  closedOnce: false,
  listeners: new Set<(view: unknown) => void>(),
  calls: [] as [string, unknown][],
}))

const mainView = (): AssistantView => ({
  on: true,
  projects: 1,
  items: main.items.map((each) => (main.told.get(each.id) === each.events ? { ...each, cardSeen: true } : each)),
  snoozed: [],
  hidden: [],
  proposals: [],
  journal: [],
  conversation: [],
  summary: { id: 'd', since: 0, came: 0, done: 0, stopped: 0, waiting: 0, projects: [], first: [], morning: null, rating: null },
  usage: { today: 0, week: 0, fiveHour: null, sevenDay: null, estimate: true },
  workHours: true,
  linked: [],
  offer: { owed: false, notice: false },
  ...(main.closedOnce ? {} : { cardBacklog: true }),
})

const changed = (): void => {
  const view = mainView()
  for (const listener of [...main.listeners]) listener(view)
}

vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  hasPreloadBridge: () => true,
  invoke: (channel: string, input: unknown) => {
    main.calls.push([channel, input])
    if (channel === 'assistant.open') return Promise.resolve({ ok: true, value: { view: mainView(), reveal: false } })
    if (channel === 'appSettings.get') return Promise.resolve({ ok: true, value: defaultAppSettings() })
    if (channel === 'assistant.cardClosed') {
      // As main does: each item is marked with the count of events the card showed of it.
      for (const { id, events } of (input as { items: { id: string; events?: number }[] }).items) {
        const found = main.items.find((each) => each.id === id)
        if (found !== undefined) main.told.set(id, events ?? found.events ?? 0)
      }
      main.closedOnce = true
      queueMicrotask(changed)
      return Promise.resolve({ ok: true, value: {} })
    }
    if (channel === 'assistant.rate') return Promise.resolve({ ok: true, value: { rule: null } })
    return Promise.resolve({ ok: true, value: {} })
  },
  subscribe: (channel: string, listener: (view: unknown) => void) => {
    if (channel !== 'assistant.changed') return () => undefined
    main.listeners.add(listener)
    return () => main.listeners.delete(listener)
  },
}))

const { AssistantSpeech } = await import('../../src/renderer/assistant/AssistantSpeech')
const { useAssistant } = await import('../../src/renderer/assistant/useAssistant')
const { useRailBadge } = await import('../../src/renderer/shell/sidebar-scope')

const item = (id: string, lastAt = 1): WindowItem => ({
  id,
  title: `Item ${id}`,
  why: null,
  source: 'session',
  sourceLabel: 'Session',
  subject: { kind: 'session', id: `s-${id}`, label: id },
  kind: 'question',
  projectId: 'p',
  projectName: 'CanvasForAI',
  duty: { id: 'waits-for-user', title: 'Waits for you' },
  urgent: false,
  state: 'new',
  startedAt: lastAt,
  lastAt,
  events: 1,
  outside: null,
  proposalId: null,
  prepare: null,
  open: null,
  rating: null,
})

const fiftySix = (): WindowItem[] => Array.from({ length: 56 }, (_, i) => item(`i${i + 1}`))

/** The number on the Assistant's rail icon, as the rail reads it. */
function Badge(): ReactElement {
  const badge = useRailBadge('AssistantSection')
  return <span data-testid="badge">{badge === undefined ? '' : String(badge.count)}</span>
}

const badge = (): string | null => screen.getByTestId('badge').textContent

/** worfy starts: a fresh window store, and the card follows main's view again. */
async function launch(): Promise<void> {
  useAssistant.setState({ view: null, tab: 'waits', focus: null, closed: [], gone: [], prepare: null })
  render(
    <>
      <AssistantSpeech sidebarVisible={false} />
      <Badge />
    </>,
  )
  await act(async () => undefined)
}

/** worfy quits: the window and everything it kept in memory go; main keeps its own. */
function quit(): void {
  cleanup()
}

const card = (): HTMLElement | null => screen.queryByTestId('assistant-say')
const close = (): void => void fireEvent.click(screen.getByRole('button', { name: 'Close' }))
const settle = async (): Promise<void> => act(async () => undefined)

beforeEach(() => {
  main.items = []
  main.told = new Map()
  main.closedOnce = false
  main.calls = []
})

afterEach(() => {
  cleanup()
})

describe('the speech card closes as a whole', () => {
  it('56 waiting and a card closed before: one Close and no card; the 56 stay on the icon; one new item, and the card tells of it alone', async () => {
    main.closedOnce = true
    main.items = fiftySix()
    await launch()
    expect(card()?.dataset['itemId']).toBe('i1')
    expect(card()?.textContent).toContain('55 more')
    close()
    expect(card()).toBeNull()
    expect(main.calls.filter(([channel]) => channel === 'assistant.cardClosed')).toEqual([['assistant.cardClosed', { items: main.items.map((each) => ({ id: each.id, events: each.events })) }]])
    await settle()
    expect(card()).toBeNull()
    expect(badge()).toBe('56')
    main.items = [item('new', 2), ...main.items]
    await act(async () => changed())
    expect(card()?.dataset['itemId']).toBe('new')
    expect(card()?.textContent).not.toContain('more')
  })

  it('a restart keeps what the card told of: the backlog does not come back', async () => {
    main.closedOnce = true
    main.items = fiftySix()
    await launch()
    close()
    await settle()
    quit()
    await launch()
    expect(card()).toBeNull()
    expect(badge()).toBe('56')
  })

  it('a new event on an item the card told of tells of it again', async () => {
    main.closedOnce = true
    main.items = fiftySix()
    await launch()
    close()
    await settle()
    main.items = main.items.map((each) => (each.id === 'i7' ? { ...each, events: 2, lastAt: 5 } : each))
    await act(async () => changed())
    expect(card()?.dataset['itemId']).toBe('i7')
  })

  it('the first launch with a backlog shows one line, «56 waiting in Assistant», not the oldest item; one Close clears it', async () => {
    main.items = fiftySix()
    await launch()
    expect(card()?.dataset['itemId']).toBeUndefined()
    expect(card()?.textContent).toContain('56 waiting in Assistant')
    expect(screen.queryByRole('button', { name: /Open|Snooze|Like|Dislike/u })).toBeNull()
    expect(badge()).toBe('56')
    close()
    await settle()
    expect(card()).toBeNull()
    quit()
    await launch()
    expect(card()).toBeNull()
  })

  it('Escape closes the card only with the keyboard focus in it or on the rail button: Escape of the Canvas, Focus mode or a field stays theirs (review round 2)', async () => {
    main.closedOnce = true
    main.items = fiftySix()
    await launch()
    const closes = () => main.calls.filter(([channel]) => channel === 'assistant.cardClosed').length
    const canvas = document.createElement('div')
    canvas.className = 'react-flow__pane'
    canvas.tabIndex = 0
    const focusMode = document.createElement('div')
    focusMode.setAttribute('role', 'region')
    focusMode.setAttribute('aria-label', 'Focus mode')
    const field = document.createElement('input')
    focusMode.append(field)
    document.body.append(canvas, focusMode)
    for (const target of [document.body, canvas, focusMode, field]) {
      fireEvent.keyDown(target, { key: 'Escape' })
      expect(card(), target.nodeName).not.toBeNull()
    }
    expect(closes()).toBe(0)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Escape' })
    expect(card()).toBeNull()
    expect(closes()).toBe(1)
    canvas.remove()
    focusMode.remove()
  })

  it('Escape on the Assistant button of the rail closes the card too', async () => {
    main.closedOnce = true
    main.items = fiftySix()
    const rail = document.createElement('button')
    rail.dataset['sectionTab'] = 'AssistantSection'
    document.body.append(rail)
    await launch()
    fireEvent.keyDown(rail, { key: 'Escape' })
    expect(card()).toBeNull()
    rail.remove()
  })

  it('an urgent item is never folded into the backlog line: the card tells of the first urgent one, the rest is «N more» (review round 2)', async () => {
    main.items = [{ ...item('stop'), urgent: true }, item('b')]
    await launch()
    expect(card()?.dataset['itemId']).toBe('stop')
    expect(card()?.textContent).toContain('Urgent')
    expect(card()?.textContent).toContain('1 more')
    expect(card()?.textContent).not.toContain('waiting in Assistant')
  })

  it('Open on the card counts as seeing the item: main keeps it as told, and the card goes on (review round 2)', async () => {
    main.closedOnce = true
    main.items = [{ ...item('a'), open: { kind: 'url', url: 'https://example.com/a' } }, item('b')]
    await launch()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(card()?.dataset['itemId']).toBe('b')
    await settle()
    expect(main.calls).toContainEqual(['assistant.cardClosed', { items: [{ id: 'a', events: 1 }] }])
  })

  it('Snooze on the card counts as seeing the item too (review round 2)', async () => {
    main.closedOnce = true
    main.items = [item('a'), item('b')]
    await launch()
    const snooze = screen.getByRole('button', { name: /Snooze/u })
    snooze.focus()
    fireEvent.keyDown(snooze, { key: 'ArrowDown' })
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
    fireEvent.click(screen.getByTestId('assistant-snooze-hour'))
    await settle()
    expect(main.calls).toContainEqual(['assistant.snooze', { itemId: 'a', choice: 'hour' }])
    expect(main.calls).toContainEqual(['assistant.cardClosed', { items: [{ id: 'a', events: 1 }] }])
    expect(card()?.dataset['itemId']).toBe('b')
  })

  it('a like acts on the item shown, and the card goes on to the next item new since the last Close', async () => {
    main.closedOnce = true
    main.items = [item('a'), item('b')]
    await launch()
    expect(card()?.dataset['itemId']).toBe('a')
    fireEvent.click(screen.getByRole('button', { name: 'Like' }))
    expect(card()?.dataset['itemId']).toBe('b')
    await settle()
    expect(main.calls).toContainEqual(['assistant.rate', { target: { kind: 'item', id: 'a' }, rating: 'like' }])
    expect(card()?.dataset['itemId']).toBe('b')
    fireEvent.click(screen.getByRole('button', { name: 'Like' }))
    await settle()
    expect(card()).toBeNull()
  })
})
