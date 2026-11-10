// The draft of a chat input field (worfy-polish ticket 95, src/renderer/session/drafts.ts): kept in
// memory at once and in the window's localStorage after a delay, cut to DRAFT_LIMIT there, cleared at
// once by a send, dropped with a Node that leaves the Layout or is archived; the Session view's field
// (MessageInput.tsx) opens with its draft and clears it when the message goes.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Layout, LayoutNode } from '../../src/shared/layout/types'
import type { OutgoingMessage } from '../../src/renderer/session/MessageInput'

const STORED = 'worfy.draft:'

const node = (id: string, archived = false): LayoutNode => ({
  id,
  kind: 'session',
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data: {},
  ...(archived ? { archived: { at: 1, rule: 'idle' as const, batch: 'b1' } } : {}),
})
const layout = (...nodes: LayoutNode[]): Layout => ({ nodes, viewport: { x: 0, y: 0, zoom: 1 } })

const stored = (): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '')
      .filter((name) => name.startsWith(STORED))
      .map((name) => [name.slice(STORED.length), localStorage.getItem(name) ?? '']),
  )

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  const answers: Record<string, unknown> = {
    'agent.commands': { commands: [] },
    'agent.controls': { settings: { model: null, effort: null, permissionMode: 'bypassPermissions' }, queue: { items: [], paused: false } },
    'agent.models': { models: [] },
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => Promise.resolve(channel in answers ? { ok: true, value: answers[channel] } : { ok: false, error: `no ${channel}` }),
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(async () => {
  // The module of this test writes what it still holds now: its timer must not write into the next test's storage.
  ;(await import('../../src/renderer/session/drafts')).flushDrafts()
  vi.useRealTimers()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('the drafts module', () => {
  it('keeps a draft in memory at once and in the storage after the delay, several lines whole; an emptied draft leaves the storage', async () => {
    vi.useFakeTimers()
    const drafts = await import('../../src/renderer/session/drafts')
    const key = drafts.draftKey('chat', 'p1', 'n1')
    expect(key).toBe('chat:p1/n1')
    drafts.keepDraft(key, 'first line\nsecond line')
    expect(drafts.readDraft(key)).toBe('first line\nsecond line')
    expect(stored()).toEqual({})
    vi.advanceTimersByTime(drafts.DRAFT_DELAY_MS - 1)
    expect(stored()).toEqual({})
    vi.advanceTimersByTime(1)
    expect(stored()).toEqual({ 'chat:p1/n1': 'first line\nsecond line' })
    drafts.keepDraft(key, '')
    vi.advanceTimersByTime(drafts.DRAFT_DELAY_MS)
    expect(stored()).toEqual({})
  })

  it('a later window reads the stored drafts; each field of a Node has its own', async () => {
    localStorage.setItem(`${STORED}chat:p1/n1`, 'in the Session view')
    localStorage.setItem(`${STORED}node:p1/n1`, 'on the Canvas')
    const drafts = await import('../../src/renderer/session/drafts')
    expect(drafts.readDraft(drafts.draftKey('chat', 'p1', 'n1'))).toBe('in the Session view')
    expect(drafts.readDraft(drafts.draftKey('node', 'p1', 'n1'))).toBe('on the Canvas')
    expect(drafts.readDraft(drafts.draftKey('chat', 'p1', 'n2'))).toBe('')
  })

  it('clearDraft empties memory and the storage at once, and a pending write does not bring the text back', async () => {
    vi.useFakeTimers()
    const drafts = await import('../../src/renderer/session/drafts')
    const key = drafts.draftKey('chat', 'p1', 'n1')
    drafts.keepDraft(key, 'kept')
    vi.advanceTimersByTime(drafts.DRAFT_DELAY_MS)
    drafts.keepDraft(key, 'kept and more')
    drafts.clearDraft(key)
    expect(drafts.readDraft(key)).toBe('')
    expect(stored()).toEqual({})
    vi.advanceTimersByTime(drafts.DRAFT_DELAY_MS * 2)
    expect(stored()).toEqual({})
  })

  it('cuts a draft past DRAFT_LIMIT in the storage; the window keeps it whole', async () => {
    const drafts = await import('../../src/renderer/session/drafts')
    const key = drafts.draftKey('chat', 'p1', 'n1')
    const long = 'x'.repeat(drafts.DRAFT_LIMIT + 10)
    expect(drafts.DRAFT_LIMIT).toBe(100_000)
    drafts.keepDraft(key, long)
    drafts.flushDrafts()
    expect(stored()[key]).toHaveLength(drafts.DRAFT_LIMIT)
    expect(drafts.readDraft(key)).toBe(long)
  })

  it('writes the pending drafts when the page goes', async () => {
    vi.useFakeTimers()
    const drafts = await import('../../src/renderer/session/drafts')
    drafts.keepDraft(drafts.draftKey('node', 'p1', 'n1'), 'typed just before the quit')
    window.dispatchEvent(new Event('pagehide'))
    expect(stored()).toEqual({ 'node:p1/n1': 'typed just before the quit' })
  })

  it('a storage that refuses the write keeps the draft in the window', async () => {
    const drafts = await import('../../src/renderer/session/drafts')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    try {
      drafts.keepDraft(drafts.draftKey('chat', 'p1', 'n1'), 'held here')
      drafts.flushDrafts()
    } finally {
      setItem.mockRestore()
    }
    expect(error).toHaveBeenCalled()
    expect(drafts.readDraft(drafts.draftKey('chat', 'p1', 'n1'))).toBe('held here')
  })

  it("drops the drafts of a Node that left the Layout or was archived, of this Project only; a Node never seen keeps its draft", async () => {
    const drafts = await import('../../src/renderer/session/drafts')
    for (const [field, project, id] of [
      ['chat', 'p1', 'deleted'],
      ['node', 'p1', 'deleted'],
      ['chat', 'p1', 'archived'],
      ['chat', 'p1', 'kept'],
      ['chat', 'p1', 'unseen'],
      ['chat', 'p2', 'deleted'],
    ] as const) {
      drafts.keepDraft(drafts.draftKey(field, project, id), `${field} ${project} ${id}`)
    }
    drafts.flushDrafts()
    drafts.dropGoneDrafts('p1', layout(node('deleted'), node('archived'), node('kept')), layout(node('archived', true), node('kept')))
    expect(stored()).toEqual({ 'chat:p1/kept': 'chat p1 kept', 'chat:p1/unseen': 'chat p1 unseen', 'chat:p2/deleted': 'chat p2 deleted' })
    expect(drafts.readDraft(drafts.draftKey('chat', 'p1', 'deleted'))).toBe('')
    expect(drafts.readDraft(drafts.draftKey('chat', 'p1', 'archived'))).toBe('')
  })

  it("the renderer's Layout copy drops the drafts as it takes a Layout (canvas/useLayout.ts)", async () => {
    const drafts = await import('../../src/renderer/session/drafts')
    const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
    drafts.keepDraft(drafts.draftKey('chat', 'p1', 'gone'), 'about to go')
    drafts.keepDraft(drafts.draftKey('chat', 'p1', 'archived'), 'about to be archived')
    acceptLayoutState({ projectId: 'p1', layout: layout(node('gone'), node('archived')), revision: 1 })
    expect(drafts.readDraft(drafts.draftKey('chat', 'p1', 'gone'))).toBe('about to go')
    acceptLayoutState({ projectId: 'p1', layout: layout(node('archived', true)), revision: 2 })
    expect(drafts.readDraft(drafts.draftKey('chat', 'p1', 'gone'))).toBe('')
    expect(drafts.readDraft(drafts.draftKey('chat', 'p1', 'archived'))).toBe('')
  })
})

describe('the Session view field keeps its draft', () => {
  async function mount(onSend: (message: OutgoingMessage) => Promise<string | null> = () => Promise.resolve(null)) {
    const drafts = await import('../../src/renderer/session/drafts')
    const { MessageInput } = await import('../../src/renderer/session/MessageInput')
    const send = vi.fn(onSend)
    const key = drafts.draftKey('chat', 'p1', 'n1')
    const view = render(<MessageInput nodeId="n1" draft={key} sessionId="s" busy={false} history={[]} recipient="Orchestrator" onSend={send} onInterrupt={() => undefined} />)
    const field = () => screen.getByRole('textbox', { name: 'Message Orchestrator' }) as HTMLTextAreaElement
    const type = async (value: string) => {
      await act(async () => {
        fireEvent.change(field(), { target: { value } })
      })
    }
    const clickSend = async () => {
      await act(async () => {
        fireEvent.click(screen.getByTestId('input-send'))
      })
    }
    return { drafts, key, view, field, type, clickSend, send }
  }

  it('a field made again shows what was typed in the one before, several lines whole', async () => {
    const { drafts, key, view, type } = await mount()
    await type('one\ntwo')
    expect(drafts.readDraft(key)).toBe('one\ntwo')
    view.unmount()
    const again = await mount()
    expect(again.field().value).toBe('one\ntwo')
  })

  it('sending clears the draft at once; a failed send brings the text back as the draft', async () => {
    let answer: string | null = 'The Session is not running'
    const { drafts, key, type, clickSend, field } = await mount(() => Promise.resolve(answer))
    await type('not sent yet')
    drafts.flushDrafts()
    await clickSend()
    expect(field().value).toBe('not sent yet')
    expect(drafts.readDraft(key)).toBe('not sent yet')
    answer = null
    await clickSend()
    expect(field().value).toBe('')
    expect(drafts.readDraft(key)).toBe('')
    expect(stored()).toEqual({})
  })
})
