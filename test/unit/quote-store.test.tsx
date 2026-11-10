// The comments of a Session (worfy-polish ticket 102, src/renderer/session/quote-store.ts): kept in
// memory at once and in the window's localStorage after a delay; read again after a restart; a sent
// round leaves the tray and stays as sent quotes, numbered in its order; a deleted comment comes back
// by Undo; a Node that leaves the Layout or is archived takes its comments along; an entry the
// storage cannot hold stays in memory, and a damaged one reads as none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layout, LayoutNode } from '../../src/shared/layout/types'
import type { QuoteComment } from '../../src/renderer/session/quote-comments'

const STORED = 'worfy.quotes:'

/** A window's localStorage, as far as the store uses it; `full` makes every write fail as a full quota does. */
class Storage {
  items = new Map<string, string>()
  full = false
  get length() {
    return this.items.size
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  getItem(name: string) {
    return this.items.get(name) ?? null
  }
  setItem(name: string, value: string) {
    if (this.full) throw new Error('QuotaExceededError')
    this.items.set(name, value)
  }
  removeItem(name: string) {
    this.items.delete(name)
  }
}

let storage: Storage

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

const comment = (id: string, fields: Partial<QuoteComment> = {}): QuoteComment => ({
  id,
  anchor: 'msg_1#0',
  start: 4,
  end: 12,
  quote: 'the step',
  text: `comment ${id}`,
  images: [],
  messageAt: 1_000,
  at: 2_000,
  ...fields,
})

const stored = (): Record<string, unknown> => Object.fromEntries([...storage.items].filter(([name]) => name.startsWith(STORED)).map(([name, value]) => [name.slice(STORED.length), JSON.parse(value)]))

beforeEach(() => {
  vi.resetModules()
  storage = new Storage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(async () => {
  ;(await import('../../src/renderer/session/quote-store')).flushQuotes()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the comments of a Session', () => {
  it('are kept per Project, Node and SDK session: in memory at once, in the storage after the delay', async () => {
    vi.useFakeTimers()
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    expect(key).toBe('p1/n1/s1')
    quotes.addDraft(key, comment('a'))
    expect(quotes.readQuotes(key).drafts.map((each) => each.id)).toEqual(['a'])
    expect(stored()).toEqual({})
    vi.advanceTimersByTime(quotes.WRITE_DELAY_MS - 1)
    expect(stored()).toEqual({})
    vi.advanceTimersByTime(1)
    expect(stored()).toEqual({ 'p1/n1/s1': { v: 1, drafts: [comment('a')], sent: [] } })
    expect(quotes.readQuotes(quotes.quoteKey('p1', 'n1', 'other'))).toBe(quotes.EMPTY_QUOTES)
  })

  it('survive a restart: the next window reads them from the storage, images too', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    const withImage = comment('a', { images: [{ kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 3, data: 'AAAA' }] })
    quotes.addDraft(key, withImage)
    quotes.forgetQuotesInMemory()
    expect(quotes.readQuotes(key).drafts).toEqual([withImage])
  })

  it('an edit changes the text and the images; a deletion answers what it deleted, and adding it back is Undo', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    quotes.addDraft(key, comment('a'))
    quotes.addDraft(key, comment('b', { start: 20, end: 24 }))
    quotes.editDraft(key, 'a', { text: 'changed', images: [] })
    expect(quotes.readQuotes(key).drafts.find((each) => each.id === 'a')?.text).toBe('changed')
    const gone = quotes.removeDrafts(key, ['a'])
    expect(gone.map((each) => each.id)).toEqual(['a'])
    expect(quotes.readQuotes(key).drafts.map((each) => each.id)).toEqual(['b'])
    for (const each of gone) quotes.addDraft(key, each)
    expect(quotes.readQuotes(key).drafts.map((each) => each.id).sort()).toEqual(['a', 'b'])
    expect(quotes.removeDrafts(key, ['none'])).toEqual([])
  })

  it('a sent round leaves the tray and stays as sent quotes, numbered in the order it went, with the message’s text', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    const first = comment('a', { images: [{ kind: 'image', name: 'x.png', mediaType: 'image/png', size: 1, data: 'AA==' }] })
    const second = comment('b', { start: 30, end: 40, quote: 'later' })
    const kept = comment('c', { anchor: 'msg_2#0' })
    quotes.addDraft(key, first)
    quotes.addDraft(key, second)
    quotes.addDraft(key, kept)
    quotes.markSent(key, [first, second], 'the message text', 5_000)
    const state = quotes.readQuotes(key)
    expect(state.drafts.map((each) => each.id)).toEqual(['c'])
    expect(state.sent).toEqual([
      { id: 'a', anchor: 'msg_1#0', start: 4, end: 12, quote: 'the step', text: 'comment a', images: 1, message: 'the message text', number: 1, at: 5_000 },
      { id: 'b', anchor: 'msg_1#0', start: 30, end: 40, quote: 'later', text: 'comment b', images: 0, message: 'the message text', number: 2, at: 5_000 },
    ])
  })

  it('keeps the newest SENT_KEPT sent quotes of a Session', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    const many = Array.from({ length: quotes.SENT_KEPT + 3 }, (_, index) => comment(`q${index}`))
    quotes.markSent(key, many, 'm', 1)
    const sent = quotes.readQuotes(key).sent
    expect(sent).toHaveLength(quotes.SENT_KEPT)
    expect(sent[0]?.id).toBe('q3')
    expect(sent.at(-1)?.id).toBe(`q${quotes.SENT_KEPT + 2}`)
  })
})

describe('a Node that goes', () => {
  it('takes its comments along when it leaves the Layout or is archived; another Project and a Node absent from both stay', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    quotes.addDraft(quotes.quoteKey('p1', 'gone', 's1'), comment('a'))
    quotes.addDraft(quotes.quoteKey('p1', 'archived', 's1'), comment('b'))
    quotes.addDraft(quotes.quoteKey('p1', 'kept', 's1'), comment('c'))
    quotes.addDraft(quotes.quoteKey('p1', 'elsewhere', 's1'), comment('d'))
    quotes.addDraft(quotes.quoteKey('p2', 'gone', 's1'), comment('e'))
    quotes.flushQuotes()
    quotes.dropGoneQuotes('p1', layout(node('gone'), node('archived'), node('kept')), layout(node('archived', true), node('kept')))
    expect(Object.keys(stored()).sort()).toEqual(['p1/elsewhere/s1', 'p1/kept/s1', 'p2/gone/s1'])
    expect(quotes.readQuotes(quotes.quoteKey('p1', 'gone', 's1'))).toBe(quotes.EMPTY_QUOTES)
  })
})

describe('a storage that fails', () => {
  it('a write past the quota keeps the comments in this window and goes to the console', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    storage.full = true
    const key = quotes.quoteKey('p1', 'n1', 's1')
    quotes.addDraft(key, comment('a'))
    quotes.flushQuotes()
    expect(stored()).toEqual({})
    expect(quotes.readQuotes(key).drafts.map((each) => each.id)).toEqual(['a'])
    expect(error).toHaveBeenCalledWith('[quotes] could not keep the comments of a Session', expect.any(Error))
  })

  it('an entry that does not read as one — not JSON, another version, a wrong shape — reads as none', async () => {
    storage.setItem(`${STORED}p1/n1/a`, '{not json')
    storage.setItem(`${STORED}p1/n1/b`, JSON.stringify({ v: 2, drafts: [], sent: [] }))
    storage.setItem(`${STORED}p1/n1/c`, JSON.stringify({ v: 1, drafts: [{ id: 'x' }], sent: [] }))
    storage.setItem(`${STORED}p1/n1/d`, JSON.stringify({ v: 1, drafts: [comment('ok')], sent: [] }))
    const quotes = await import('../../src/renderer/session/quote-store')
    for (const name of ['a', 'b', 'c']) expect(quotes.readQuotes(`p1/n1/${name}`)).toBe(quotes.EMPTY_QUOTES)
    expect(quotes.readQuotes('p1/n1/d').drafts.map((each) => each.id)).toEqual(['ok'])
  })
})
