// The comments of a Session (worfy-polish ticket 102, src/renderer/session/quote-store.ts): kept in
// memory at once and in the window's localStorage after a delay, with no image bytes; read again after
// a restart; a sent round leaves the tray and waits for its prompt, then stays as sent quotes numbered
// in its order with its text kept once, or goes back to the tray; a deleted comment comes back by
// Undo; a Node keeps the comments of its three Sessions changed last; a Node that leaves the Layout or
// is archived takes its comments along; a write the storage refuses is told to its listeners, and an
// entry that does not read as one reads as none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layout, LayoutNode } from '../../src/shared/layout/types'
import type { CommentImage, PendingRound, QuoteComment } from '../../src/renderer/session/quote-comments'

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

const REF = 'a'.repeat(64)
const shot: CommentImage = { kind: 'image', name: 'shot.png', mediaType: 'image/png', size: 3, ref: REF }
const round = (id: string, comments: QuoteComment[], message = 'the message text', at = 5_000): PendingRound => ({ id, message, at, comments })

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
    vi.useFakeTimers({ now: 7_000 })
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    expect(key).toBe('p1/n1/s1')
    quotes.addDraft(key, comment('a'))
    expect(quotes.readQuotes(key).drafts.map((each) => each.id)).toEqual(['a'])
    expect(stored()).toEqual({})
    vi.advanceTimersByTime(quotes.WRITE_DELAY_MS - 1)
    expect(stored()).toEqual({})
    vi.advanceTimersByTime(1)
    expect(stored()).toEqual({ 'p1/n1/s1': { v: 2, at: 7_000, drafts: [comment('a')], pending: [], rounds: [], sent: [] } })
    expect(quotes.readQuotes(quotes.quoteKey('p1', 'n1', 'other'))).toBe(quotes.EMPTY_QUOTES)
  })

  it('survive a restart: the next window reads them from the storage, an image by its ref and with no bytes', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    const withImage = comment('a', { images: [shot] })
    quotes.addDraft(key, withImage)
    quotes.keepImageData(REF, 'QUJD')
    expect(quotes.imageDataOf(REF)).toBe('QUJD')
    quotes.flushQuotes()
    expect(JSON.stringify(stored())).not.toContain('QUJD')
    quotes.forgetQuotesInMemory()
    expect(quotes.readQuotes(key).drafts).toEqual([withImage])
    // The bytes were this window's alone: the next one reads them back from main.
    expect(quotes.imageDataOf(REF)).toBeUndefined()
  })

  it('an image with bytes in place of a ref does not read as one', async () => {
    storage.setItem(`${STORED}p1/n1/s1`, JSON.stringify({ v: 2, at: 1, drafts: [comment('a', { images: [{ ...shot, ref: undefined, data: 'QUJD' } as unknown as CommentImage] })], pending: [], rounds: [], sent: [] }))
    const quotes = await import('../../src/renderer/session/quote-store')
    expect(quotes.readQuotes('p1/n1/s1')).toBe(quotes.EMPTY_QUOTES)
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
})

describe('a sent round', () => {
  it('leaves the tray and waits; once its prompt came it stays as sent quotes, numbered in its order, its text kept once', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    const first = comment('a', { images: [shot] })
    const second = comment('b', { start: 30, end: 40, quote: 'later' })
    const kept = comment('c', { anchor: 'msg_2#0' })
    for (const each of [first, second, kept]) quotes.addDraft(key, each)
    quotes.markPending(key, round('r1', [first, second]))
    let state = quotes.readQuotes(key)
    expect(state.drafts.map((each) => each.id)).toEqual(['c'])
    expect(state.pending).toEqual([round('r1', [first, second])])
    expect(state.sent).toEqual([])
    expect(quotes.settlePending(key, 'r1', 'sent')).toEqual(round('r1', [first, second]))
    state = quotes.readQuotes(key)
    expect(state.pending).toEqual([])
    expect(state.rounds).toEqual([{ id: 'r1', message: 'the message text', at: 5_000 }])
    expect(state.sent).toEqual([
      { id: 'a', round: 'r1', anchor: 'msg_1#0', start: 4, end: 12, quote: 'the step', text: 'comment a', images: 1, number: 1 },
      { id: 'b', round: 'r1', anchor: 'msg_1#0', start: 30, end: 40, quote: 'later', text: 'comment b', images: 0, number: 2 },
    ])
    quotes.flushQuotes()
    expect(JSON.stringify(stored()).split('the message text')).toHaveLength(2)
  })

  it('goes back to the tray as it was when its message left the queue unsent; settling it twice does nothing', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    const first = comment('a', { images: [shot] })
    quotes.addDraft(key, first)
    quotes.addDraft(key, comment('b', { start: 30, end: 40 }))
    quotes.markPending(key, round('r1', [first]))
    expect(quotes.settlePending(key, 'r1', 'back')).not.toBeNull()
    const state = quotes.readQuotes(key)
    expect(state.pending).toEqual([])
    expect(state.sent).toEqual([])
    expect(state.drafts.map((each) => each.id).sort()).toEqual(['a', 'b'])
    expect(state.drafts.find((each) => each.id === 'a')).toEqual(first)
    expect(quotes.settlePending(key, 'r1', 'back')).toBeNull()
    expect(quotes.settlePending(key, 'r1', 'sent')).toBeNull()
    expect(quotes.readQuotes(key).drafts).toHaveLength(2)
  })

  it('waits across a restart', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    quotes.markPending(key, round('r1', [comment('a')]))
    quotes.forgetQuotesInMemory()
    expect(quotes.readQuotes(key).pending.map((each) => each.id)).toEqual(['r1'])
  })

  it('keeps the newest SENT_KEPT sent quotes of a Session, and the text of a round only while a quote of it is kept', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const key = quotes.quoteKey('p1', 'n1', 's1')
    quotes.markPending(key, round('old', [comment('o1'), comment('o2')], 'old text'))
    quotes.settlePending(key, 'old', 'sent')
    const many = Array.from({ length: quotes.SENT_KEPT - 1 }, (_, index) => comment(`q${index}`))
    quotes.markPending(key, round('new', many, 'new text'))
    quotes.settlePending(key, 'new', 'sent')
    let state = quotes.readQuotes(key)
    expect(state.sent).toHaveLength(quotes.SENT_KEPT)
    expect(state.sent[0]?.id).toBe('o2')
    expect(state.rounds.map((each) => each.id)).toEqual(['old', 'new'])
    quotes.markPending(key, round('last', [comment('z')], 'last text'))
    quotes.settlePending(key, 'last', 'sent')
    state = quotes.readQuotes(key)
    expect(state.sent).toHaveLength(quotes.SENT_KEPT)
    expect(state.sent[0]?.id).toBe('q0')
    expect(state.rounds.map((each) => each.id)).toEqual(['new', 'last'])
  })
})

describe('the Sessions of a Node', () => {
  it('keeps the comments of its SESSIONS_KEPT Sessions changed last; another Node’s stay', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    expect(quotes.SESSIONS_KEPT).toBe(3)
    quotes.changeQuotes(quotes.quoteKey('p1', 'n2', 'other'), (state) => ({ ...state, drafts: [comment('x')] }), 1)
    for (const [index, session] of ['s1', 's2', 's3'].entries()) quotes.changeQuotes(quotes.quoteKey('p1', 'n1', session), (state) => ({ ...state, drafts: [comment(session)] }), 10 + index)
    // s1 changes again: s2 is now the one changed longest ago.
    quotes.changeQuotes(quotes.quoteKey('p1', 'n1', 's1'), (state) => ({ ...state, drafts: [...state.drafts, comment('again')] }), 20)
    quotes.changeQuotes(quotes.quoteKey('p1', 'n1', 's4'), (state) => ({ ...state, drafts: [comment('s4')] }), 30)
    quotes.flushQuotes()
    expect(Object.keys(stored()).sort()).toEqual(['p1/n1/s1', 'p1/n1/s3', 'p1/n1/s4', 'p1/n2/other'])
    expect(quotes.readQuotes(quotes.quoteKey('p1', 'n1', 's2'))).toBe(quotes.EMPTY_QUOTES)
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
  it('a write past the quota keeps the comments in this window, goes to the console and to every listener', async () => {
    const quotes = await import('../../src/renderer/session/quote-store')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const heard: unknown[] = []
    const stop = quotes.onQuoteStoreError((each) => heard.push(each))
    storage.full = true
    const key = quotes.quoteKey('p1', 'n1', 's1')
    quotes.addDraft(key, comment('a'))
    quotes.flushQuotes()
    expect(stored()).toEqual({})
    expect(quotes.readQuotes(key).drafts.map((each) => each.id)).toEqual(['a'])
    expect(error).toHaveBeenCalledWith('[quotes] could not keep the comments of a Session', expect.any(Error))
    expect(heard).toEqual([expect.any(Error)])
    stop()
    quotes.addDraft(key, comment('b'))
    quotes.flushQuotes()
    expect(heard).toHaveLength(1)
  })

  it('an entry that does not read as one — not JSON, another version, a wrong shape — reads as none', async () => {
    const empty = { at: 1, pending: [], rounds: [], sent: [] }
    storage.setItem(`${STORED}p1/n1/a`, '{not json')
    storage.setItem(`${STORED}p1/n1/b`, JSON.stringify({ v: 1, drafts: [comment('old')], sent: [] }))
    storage.setItem(`${STORED}p1/n1/c`, JSON.stringify({ v: 2, ...empty, drafts: [{ id: 'x' }] }))
    storage.setItem(`${STORED}p1/n1/d`, JSON.stringify({ v: 2, ...empty, drafts: [comment('ok')] }))
    const quotes = await import('../../src/renderer/session/quote-store')
    for (const name of ['a', 'b', 'c']) expect(quotes.readQuotes(`p1/n1/${name}`)).toBe(quotes.EMPTY_QUOTES)
    expect(quotes.readQuotes('p1/n1/d').drafts.map((each) => each.id)).toEqual(['ok'])
  })
})
