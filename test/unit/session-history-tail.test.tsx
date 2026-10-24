// How the window keeps a transcript read from its end (worfy-ui ticket 21,
// src/renderer/claude-home/useClaudeHome.ts): the KEEP_EVENTS cap and «Load earlier», a stale
// «Load earlier» answer after the file was opened again, the control in the transcript
// (src/renderer/session/Transcript.tsx), and the last answer of a resumed Session Node, which reads
// only the window at the end of the file. A fake bridge answers; no main process.
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'

const ROOT = '/Users/test/projects/demo'
const PROJECT = { id: 'demo-0000000a', name: 'demo', path: ROOT, branch: 'main' }
const S = 'dddddddd-0000-4000-8000-000000000021'
const WINDOW = 4 * 1024 * 1024

type Request = { cursor?: { offset: number; fileId: string | null }; maxBytes?: number; back?: { bytes: number; before?: { offset: number; fileId: string | null } } }
type Answer = { found: boolean; events: AgentEvent[]; cursor: { offset: number; fileId: string | null }; reset: boolean; more: boolean; earlier?: number; offsets?: number[] }

/** The answer to each `claudeHome.transcript` call, in order; a call with none waits until `release()`. */
let answers: ((request: Request) => Answer | Promise<Answer>)[]
const requests: Request[] = []
let views: SessionNodeView[]
let changed: ((payload: unknown) => void) | undefined

beforeEach(() => {
  vi.resetModules()
  answers = []
  requests.length = 0
  views = []
  changed = undefined
  const bridge = {
    invoke: async (channel: string, input: unknown) => {
      if (channel === 'claudeHome.transcript') {
        const request = input as Request
        requests.push(request)
        const answer = answers.shift()
        if (!answer) return { ok: false, error: 'no answer left' }
        return { ok: true, value: await answer(request) }
      }
      const value: unknown =
        channel === 'projects.list'
          ? { projects: [PROJECT], activeId: PROJECT.id, revision: 1 }
          : channel === 'claudeHome.sessions'
            ? { live: [], history: [] }
            : channel === 'claudeHome.live'
              ? { live: [] }
              : channel === 'sessions.views'
                ? { views }
                : undefined
      if (channel === 'orchestrator.view') return new Promise(() => undefined)
      return value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value }
    },
    on: (channel: string, listener: (payload: unknown) => void) => {
      if (channel === 'claudeHome.changed') changed = listener
      return 1
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const answer = (n: number): AgentEvent => ({ type: 'text', text: `answer ${n}`, messageId: `m${n}`, parentToolUseId: null, synthetic: false })
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, at) => from + at)
/** Events `from`..`to - 1`, one line each, line N at byte N * 100. */
const lines = (from: number, to: number) => ({ events: range(from, to).map(answer), offsets: range(from, to).map((n) => n * 100) })
const FILE = 'dev:ino'
const ok = (part: Partial<Answer>): Answer => ({ found: true, events: [], cursor: { offset: 0, fileId: FILE }, reset: false, more: false, ...part })
const texts = (events: readonly AgentEvent[]) => events.map((event) => (event.type === 'text' ? event.text : event.type))

async function openTranscript() {
  const module = await import('../../src/renderer/claude-home/useClaudeHome')
  const hook = renderHook(() => module.useSessionTranscript(ROOT, S))
  await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true))
  return { module, hook }
}

/** The height of a transcript row in px, in the layout below. */
const ROW = 100

/**
 * Lays out the transcript log, which jsdom does not: the log is 300 px tall at the top of the
 * window, each row `height(row)` px (ROW by default) one under the other with `gap` px between
 * them, a row that draws nothing takes no room (`.w-tr__item:empty`), the space of the rows not
 * drawn (worfy-ui ticket 22) is as tall as its style says, an element inside a row is a line at
 * the top of its row, and scrollTop keeps what is set. `attach` gives the log its scroll geometry
 * once it is rendered; `hide` takes its height away as the Canvas on screen does, `show` gives it back.
 */
function layOut(height: (row: Element) => number = () => ROW, gap = 0) {
  let log: HTMLElement | null = null
  let top = 0
  let hidden = false
  const children = () => Array.from(log?.children ?? []).filter((row) => !row.hasAttribute('data-transcript-earlier'))
  const rows = () => children().filter((row) => row.hasAttribute('data-item'))
  const empty = (child: Element): boolean => child.hasAttribute('data-item') && child.childNodes.length === 0
  const tall = (child: Element): number => (child.hasAttribute('data-item') ? height(child) : Number.parseFloat((child as HTMLElement).style.height) || 0)
  /** Where each child of the log starts, and the height of all of them. */
  const place = () => {
    const tops = new Map<Element, number>()
    let y = 0
    for (const child of children()) {
      tops.set(child, y)
      if (!empty(child)) y += tall(child) + gap
    }
    return { tops, height: Math.max(0, y - gap) }
  }
  const rectOf = (element: Element): DOMRect => {
    if (hidden) return new DOMRect(0, 0, 0, 0)
    if (element === log) return new DOMRect(0, 0, 800, 300)
    const child = children().find((one) => one.contains(element))
    const at = child === undefined ? undefined : place().tops.get(child)
    if (child === undefined || at === undefined) return new DOMRect(0, 0, 0, 0)
    return new DOMRect(0, at - top, 800, child !== element ? 18 : empty(child) ? 0 : tall(child))
  }
  const measured = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(this)
  })
  const computed = window.getComputedStyle.bind(window)
  const styles = vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    const style = computed(element, pseudo)
    return element === log ? ({ ...style, rowGap: `${gap}px` } as CSSStyleDeclaration) : style
  })
  return {
    attach(element: HTMLElement) {
      log = element
      Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => (hidden ? 0 : place().height) })
      Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => (hidden ? 0 : 300) })
      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: () => (hidden ? 0 : top),
        set: (value: number) => {
          if (!hidden) top = value
        },
      })
    },
    hide: () => (hidden = true),
    /** `drop`: the browser gave up the scroll offset of the hidden element. */
    show: (drop = false) => {
      hidden = false
      if (drop) top = 0
    },
    rows,
    /** The row of «answer n». */
    rowOf: (n: number) => rows().find((row) => new RegExp(`answer ${n}(?!\\d)`).test(row.textContent ?? '')),
    restore: () => {
      measured.mockRestore()
      styles.mockRestore()
    },
  }
}

/**
 * Scrolls the log as a reader would until «answer n» is at its top: down a screen at a time while
 * the row is not drawn (the Transcript draws only the rows around the visible part), then onto it.
 */
function scrollToAnswer(log: HTMLElement, layout: ReturnType<typeof layOut>, n: number): void {
  log.scrollTop = 0
  fireEvent.scroll(log)
  for (let round = 0; round < 200; round += 1) {
    const row = layout.rowOf(n)
    if (row !== undefined && row.getBoundingClientRect().top === 0) return
    log.scrollTop += row === undefined ? 300 : row.getBoundingClientRect().top
    fireEvent.scroll(log)
  }
  throw new Error(`answer ${n} was not scrolled to`)
}

const transcriptChanged = () =>
  act(async () => {
    changed?.({ projectRoot: ROOT, sessions: false, transcripts: [S] })
  })

describe('the KEEP_EVENTS cap of a transcript read from its end', () => {
  it('keeps the newest events of the window, and Load earlier brings the dropped ones back with no gap', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    // The window at the end: KEEP_EVENTS + 1000 events from line 500 on.
    answers.push(() => ok({ ...lines(500, 500 + keep + 1000), earlier: 500 * 100, cursor: { offset: (500 + keep + 1000) * 100, fileId: FILE } }))
    const { hook } = await openTranscript()
    expect(requests[0]).toStrictEqual({ projectRoot: ROOT, sessionId: S, back: { bytes: WINDOW } })
    expect(hook.result.current.events).toHaveLength(keep)
    expect(texts(hook.result.current.events)[0]).toBe('answer 1500')
    // «Load earlier» now ends where the kept events start, not where the window did.
    expect(hook.result.current.earlier).toBe(1500 * 100)

    answers.push((request) => {
      expect(request.back).toStrictEqual({ bytes: WINDOW, before: { offset: 150_000, fileId: FILE } })
      return ok({ ...lines(0, 1500), earlier: 0, cursor: { offset: 150_000, fileId: FILE } })
    })
    await act(async () => {
      await module.loadEarlierTranscript(ROOT, S)
    })
    const loaded = hook.result.current
    expect(texts(loaded.events)).toEqual(range(0, 1500 + keep).map((n) => `answer ${n}`))
    expect(loaded.earlier).toBe(0)
    expect(loaded.first).toBe(1000 - 1500)

    // Events the reader asked for stay: records appended later drop nothing.
    answers.push((request) => {
      expect(request.cursor).toStrictEqual({ offset: (500 + keep + 1000) * 100, fileId: FILE })
      return ok({ ...lines(500 + keep + 1000, 500 + keep + 1010), cursor: { offset: (500 + keep + 1010) * 100, fileId: FILE } })
    })
    await transcriptChanged()
    await vi.waitFor(() => expect(hook.result.current.events).toHaveLength(1500 + keep + 10))
    expect(texts(hook.result.current.events)[0]).toBe('answer 0')
  })

  it('drops whole lines: the events of the line the cut falls in go with it', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    // KEEP_EVENTS + 1 events; the first three come from one line (a tool result and its two events).
    const events = range(0, keep + 1).map(answer)
    const offsets = range(0, keep + 1).map((n) => (n < 3 ? 0 : n * 100))
    answers.push(() => ok({ events, offsets, earlier: 0, cursor: { offset: (keep + 1) * 100, fileId: FILE } }))
    const { hook } = await openTranscript()
    expect(hook.result.current.events).toHaveLength(keep - 2)
    expect(texts(hook.result.current.events)[0]).toBe('answer 3')
    expect(hook.result.current.earlier).toBe(300)
    expect(hook.result.current.first).toBe(3)
  })
})

describe('Load earlier', () => {
  it('is offered until the events start at the beginning of the file', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    answers.push(() => ok({ ...lines(10, 20), earlier: 1000, cursor: { offset: 2000, fileId: FILE } }))
    const { hook } = await openTranscript()
    expect(module.earlierControl(hook.result.current, ROOT, S)).toMatchObject({ loading: false })
    let release: (value: Answer) => void = () => undefined
    answers.push(() => new Promise<Answer>((done) => (release = done)))
    const loading = module.loadEarlierTranscript(ROOT, S)
    await vi.waitFor(() => expect(hook.result.current.loadingEarlier).toBe(true))
    expect(module.earlierControl(hook.result.current, ROOT, S)).toMatchObject({ loading: true })
    // A second press while the first reads asks nothing more.
    await module.loadEarlierTranscript(ROOT, S)
    expect(requests).toHaveLength(2)
    await act(async () => {
      release(ok({ ...lines(0, 10), earlier: 0, cursor: { offset: 1000, fileId: FILE } }))
      await loading
    })
    expect(texts(hook.result.current.events)).toEqual(range(0, 20).map((n) => `answer ${n}`))
    expect(module.earlierControl(hook.result.current, ROOT, S)).toBeUndefined()
    // At the start of the file a press asks nothing.
    await module.loadEarlierTranscript(ROOT, S)
    expect(requests).toHaveLength(2)
  })

  it('an answer that arrives after the file was opened again from its end is dropped', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    answers.push(() => ok({ ...lines(10, 20), earlier: 1000, cursor: { offset: 2000, fileId: FILE } }))
    const { hook } = await openTranscript()
    let release: (value: Answer) => void = () => undefined
    answers.push(() => new Promise<Answer>((done) => (release = done)))
    const loading = module.loadEarlierTranscript(ROOT, S)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    // Meanwhile the file was replaced: the forward read says reset, and the end is read again.
    answers.push(() => ok({ reset: true }))
    answers.push(() => ok({ ...lines(0, 5), earlier: 0, cursor: { offset: 500, fileId: 'dev:other' } }))
    await transcriptChanged()
    await vi.waitFor(() => expect(texts(hook.result.current.events)).toEqual(range(0, 5).map((n) => `answer ${n}`)))
    await act(async () => {
      release(ok({ ...lines(0, 10), earlier: 0, cursor: { offset: 1000, fileId: FILE } }))
      await loading
    })
    expect(texts(hook.result.current.events)).toEqual(range(0, 5).map((n) => `answer ${n}`))
    expect(hook.result.current.loadingEarlier).toBe(false)
  })

  it('a file replaced under the shown events opens it again from its end', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    answers.push(() => ok({ ...lines(10, 20), earlier: 1000, cursor: { offset: 2000, fileId: FILE } }))
    const { hook } = await openTranscript()
    const opened = hook.result.current.opening
    answers.push(() => ok({ reset: true }))
    answers.push((request) => {
      expect(request.back).toStrictEqual({ bytes: WINDOW })
      return ok({ ...lines(0, 3), earlier: 0, cursor: { offset: 300, fileId: 'dev:other' } })
    })
    await act(async () => {
      await module.loadEarlierTranscript(ROOT, S)
    })
    await vi.waitFor(() => expect(texts(hook.result.current.events)).toEqual(['answer 0', 'answer 1', 'answer 2']))
    // A new `opening`: find in the Session view drops what main said of the old file (worfy-ui ticket 26).
    expect(opened).toEqual(expect.any(Number))
    expect(hook.result.current.opening).toBeGreaterThan(opened ?? Number.POSITIVE_INFINITY)
  })

  it('an answer from the old file is dropped when the file was opened again at the same start', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    answers.push(() => ok({ ...lines(10, 20), earlier: 1000, cursor: { offset: 2000, fileId: FILE } }))
    const { hook } = await openTranscript()
    let release: (value: Answer) => void = () => undefined
    answers.push(() => new Promise<Answer>((done) => (release = done)))
    const loading = module.loadEarlierTranscript(ROOT, S)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    // The file was replaced by one whose window at the end starts at the same byte: only the
    // reopening tells the old answer from a good one.
    answers.push(() => ok({ reset: true }))
    answers.push(() => ok({ ...lines(10, 25), earlier: 1000, cursor: { offset: 2500, fileId: 'dev:other' } }))
    await transcriptChanged()
    await vi.waitFor(() => expect(hook.result.current.events).toHaveLength(15))
    expect(hook.result.current.earlier).toBe(1000)
    await act(async () => {
      release(ok({ ...lines(0, 10), earlier: 0, cursor: { offset: 1000, fileId: FILE } }))
      await loading
    })
    expect(texts(hook.result.current.events)).toEqual(range(10, 25).map((n) => `answer ${n}`))
    expect(hook.result.current.loadingEarlier).toBe(false)
    expect(hook.result.current.earlier).toBe(1000)
  })

  it('asks again from the new start when the cap dropped old events while it read', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    const end = (100 + keep) * 100
    answers.push(() => ok({ ...lines(100, 100 + keep), earlier: 100 * 100, cursor: { offset: end, fileId: FILE } }))
    const { hook } = await openTranscript()
    let release: (value: Answer) => void = () => undefined
    answers.push(() => new Promise<Answer>((done) => (release = done)))
    const loading = module.loadEarlierTranscript(ROOT, S)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    // Ten records come while it reads: the cap drops the ten oldest shown, the start moves.
    answers.push(() => ok({ ...lines(100 + keep, 110 + keep), cursor: { offset: end + 1000, fileId: FILE } }))
    await transcriptChanged()
    await vi.waitFor(() => expect(hook.result.current.earlier).toBe(110 * 100))
    answers.push((request) => {
      expect(request.back).toStrictEqual({ bytes: WINDOW, before: { offset: 110 * 100, fileId: FILE } })
      return ok({ ...lines(0, 110), earlier: 0, cursor: { offset: 110 * 100, fileId: FILE } })
    })
    await act(async () => {
      release(ok({ ...lines(0, 100), earlier: 0, cursor: { offset: 100 * 100, fileId: FILE } }))
      await loading
    })
    expect(requests).toHaveLength(4)
    expect(texts(hook.result.current.events)).toEqual(range(0, 110 + keep).map((n) => `answer ${n}`))
    expect(hook.result.current.earlier).toBe(0)
    expect(hook.result.current.loadingEarlier).toBe(false)
  })

  it('stays loading through every ask again, and gives up after five moves with the control back', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    answers.push(() => ok({ ...lines(100, 100 + keep), earlier: 100 * 100, cursor: { offset: (100 + keep) * 100, fileId: FILE } }))
    const { hook } = await openTranscript()
    let release: (value: Answer) => void = () => undefined
    const waiting = () => new Promise<Answer>((done) => (release = done))
    answers.push(waiting)
    const loading = module.loadEarlierTranscript(ROOT, S)
    for (let move = 0; move < 5; move += 1) {
      await vi.waitFor(() => expect(requests).toHaveLength(2 + 2 * move))
      // Ten records come while it reads: the cap moves the start, the answer no longer joins.
      const at = 100 + keep + 10 * move
      answers.push(() => ok({ ...lines(at, at + 10), cursor: { offset: (at + 10) * 100, fileId: FILE } }))
      await transcriptChanged()
      await vi.waitFor(() => expect(hook.result.current.earlier).toBe((110 + 10 * move) * 100))
      expect(hook.result.current.loadingEarlier).toBe(true)
      if (move < 4) answers.push(waiting)
      const answered = release
      await act(async () => {
        answered(ok({ ...lines(0, 10), earlier: 0, cursor: { offset: 1000, fileId: FILE } }))
      })
      if (move < 4) expect(hook.result.current.loadingEarlier).toBe(true)
    }
    await act(async () => {
      await loading
    })
    expect(requests).toHaveLength(11)
    expect(hook.result.current.loadingEarlier).toBe(false)
    expect(module.earlierControl(hook.result.current, ROOT, S)).toMatchObject({ loading: false })
  })

  it('an ask again that finds no start to read from ends the loading', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    answers.push(() => ok({ ...lines(100, 110), earlier: 100 * 100, cursor: { offset: 110 * 100, fileId: FILE } }))
    const { hook } = await openTranscript()
    let release: (value: Answer) => void = () => undefined
    answers.push(() => new Promise<Answer>((done) => (release = done)))
    const loading = module.loadEarlierTranscript(ROOT, S)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    // KEEP_EVENTS records come with no lines (a main that sends no offsets): the cap drops every
    // event of the window, and no line is left to read before.
    answers.push(() => ({ found: true, events: range(110, 110 + keep).map(answer), cursor: { offset: (110 + keep) * 100, fileId: FILE }, reset: false, more: false }))
    await transcriptChanged()
    await vi.waitFor(() => expect(hook.result.current.earlier).toBeNull())
    await act(async () => {
      release(ok({ ...lines(0, 100), earlier: 0, cursor: { offset: 100 * 100, fileId: FILE } }))
      await loading
    })
    expect(requests).toHaveLength(3)
    expect(hook.result.current.loadingEarlier).toBe(false)
  })

  it('a file gone under the shown events opens it again from its end', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    answers.push(() => ok({ ...lines(10, 20), earlier: 1000, cursor: { offset: 2000, fileId: FILE } }))
    const { hook } = await openTranscript()
    answers.push(() => ({ found: false, events: [], cursor: { offset: 0, fileId: null }, reset: false, more: false }))
    answers.push((request) => {
      expect(request.back).toStrictEqual({ bytes: WINDOW })
      return { found: false, events: [], cursor: { offset: 0, fileId: null }, reset: false, more: false }
    })
    await act(async () => {
      await module.loadEarlierTranscript(ROOT, S)
    })
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    await vi.waitFor(() => expect(hook.result.current.found).toBe(false))
    expect(hook.result.current.events).toEqual([])
    expect(module.earlierControl(hook.result.current, ROOT, S)).toBeUndefined()
  })

  it('loadEarlierUntil reads on while a window adds nothing the caller shows', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    answers.push(() => ok({ ...lines(20, 30), earlier: 2000, cursor: { offset: 3000, fileId: FILE } }))
    const { hook } = await openTranscript()
    answers.push(() => ok({ ...lines(15, 20), earlier: 1500, cursor: { offset: 2000, fileId: FILE } }))
    answers.push(() => ok({ ...lines(10, 15), earlier: 1000, cursor: { offset: 1500, fileId: FILE } }))
    // The caller counts only events 0..14 as new rows: the first window (15..19) adds none.
    const grew = () => module.sessionTranscriptNow(ROOT, S).events.some((event) => event.type === 'text' && Number(event.text.split(' ')[1]) < 15)
    await act(async () => {
      await module.loadEarlierUntil(ROOT, S, grew)
    })
    expect(requests).toHaveLength(3)
    expect(texts(hook.result.current.events)).toEqual(range(10, 30).map((n) => `answer ${n}`))
    expect(hook.result.current.earlier).toBe(1000)
  })

  it('loadEarlierUntil stops after a read that fails: one request and one error toast, not a hundred', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const { toasts } = await import('../../src/renderer/toast/toasts')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answers.push(() => ok({ ...lines(20, 30), earlier: 2000, cursor: { offset: 3000, fileId: FILE } }))
    const { hook } = await openTranscript()
    // No answer left: the bridge says the read failed; `earlier` stays where it was.
    await act(async () => {
      await module.loadEarlierUntil(ROOT, S, () => false)
    })
    expect(requests).toHaveLength(2)
    const errors = toasts.getState().toasts.filter((toast) => toast.kind === 'error' && toast.text.startsWith('Earlier messages could not be read'))
    expect(errors).toHaveLength(1)
    expect(hook.result.current.earlier).toBe(2000)
    expect(hook.result.current.loadingEarlier).toBe(false)
    vi.restoreAllMocks()
  })

  it('a forward read under way when Load earlier finds the file replaced does not cancel the reopening from the end', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    answers.push(() => ok({ ...lines(10, 20), earlier: 1000, cursor: { offset: 2000, fileId: FILE } }))
    const { hook } = await openTranscript()
    // Records were appended: the forward read starts and waits.
    let release: (value: Answer) => void = () => undefined
    answers.push(() => new Promise<Answer>((done) => (release = done)))
    await transcriptChanged()
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    // Load earlier meanwhile: the file under the shown events was replaced.
    answers.push(() => ok({ reset: true }))
    await act(async () => {
      await module.loadEarlierTranscript(ROOT, S)
    })
    expect(requests).toHaveLength(3)
    // The forward read ends with what it read of the old file; the file is then opened from its end.
    answers.push((request) => {
      expect(request.back).toStrictEqual({ bytes: WINDOW })
      return ok({ ...lines(0, 3), earlier: 0, cursor: { offset: 300, fileId: 'dev:other' } })
    })
    await act(async () => {
      release(ok({ ...lines(20, 25), cursor: { offset: 2500, fileId: FILE } }))
    })
    await vi.waitFor(() => expect(requests).toHaveLength(4))
    expect(requests[3]).toStrictEqual({ projectRoot: ROOT, sessionId: S, back: { bytes: WINDOW } })
    await vi.waitFor(() => expect(texts(hook.result.current.events)).toEqual(['answer 0', 'answer 1', 'answer 2']))
  })

  it('ExternalSessionPanel: the row the reader looked at stays in place when the cap moved the first row while Load earlier read', { timeout: 60_000 }, async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const { ExternalSessionPanel } = await import('../../src/renderer/session/ExternalSessionPanel')
    const keep = module.KEEP_EVENTS
    const end = (100 + keep) * 100
    answers.push(() => ok({ ...lines(100, 100 + keep), earlier: 100 * 100, cursor: { offset: end, fileId: FILE } }))
    const layout = layOut()
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const had = actEnvironment.IS_REACT_ACT_ENVIRONMENT
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<ExternalSessionPanel projectId={PROJECT.id} nodeId="claude-session:dddd" sessionId={S} />)
      await vi.waitFor(() => expect(screen.getByTestId('transcript').textContent).toContain(`answer ${99 + keep}`), { timeout: 20_000 })
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      // The reader scrolled up to «answer 120» and pressed Load earlier.
      scrollToAnswer(log, layout, 120)
      // Every frame React draws counts from here on, as in the window: no act() batches them.
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
      let release: (value: Answer) => void = () => undefined
      answers.push(() => new Promise<Answer>((done) => (release = done)))
      fireEvent.click(screen.getByRole('button', { name: 'Load earlier' }))
      await vi.waitFor(() => expect(requests).toHaveLength(2))
      // Ten records come while it reads: the cap drops the ten oldest shown, the start moves.
      answers.push(() => ok({ ...lines(100 + keep, 110 + keep), cursor: { offset: end + 1000, fileId: FILE } }))
      changed?.({ projectRoot: ROOT, sessions: false, transcripts: [S] })
      await vi.waitFor(() => expect(module.sessionTranscriptNow(ROOT, S).earlier).toBe(110 * 100))
      await vi.waitFor(() => expect(layout.rowOf(110)).toBeDefined())
      // The answer no longer joins the shown events: it is asked again from the new start.
      answers.push(() => ok({ ...lines(0, 110), earlier: 0, cursor: { offset: 110 * 100, fileId: FILE } }))
      release(ok({ ...lines(0, 100), earlier: 0, cursor: { offset: 100 * 100, fileId: FILE } }))
      // All of the file is read: the 110 rows of the second answer (answers 0–109) are the space
      // above the first row drawn, «answer 110», OVERSCAN px above the reader's.
      await vi.waitFor(() => expect(requests).toHaveLength(4), { timeout: 20_000 })
      await vi.waitFor(() => expect(module.sessionTranscriptNow(ROOT, S).events).toHaveLength(110 + keep), { timeout: 20_000 })
      await vi.waitFor(() => {
        const space = log.querySelector<HTMLElement>(':scope > [data-space]')
        expect(space?.style.height).toBe(`${110 * ROW}px`)
        expect(space?.nextElementSibling?.textContent).toContain('answer 110')
      })
      expect(screen.queryByRole('button', { name: 'Load earlier' })).toBeNull()
      expect(requests).toHaveLength(4)
      expect(layout.rowOf(120)?.getBoundingClientRect().top).toBe(0)
    } finally {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = had
      layout.restore()
      vi.restoreAllMocks()
    }
  })

  it('the row the reader looked at stays in place when fewer rows came on top than the cap dropped meanwhile', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const layout = layOut()
    try {
      const load = vi.fn()
      const shown = (from: number, to: number, loading: boolean) => <Transcript events={range(from, to).map(answer)} firstIndex={from} earlier={{ load, loading }} />
      const { rerender } = render(shown(10, 20, false))
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      // The reader scrolled up to «answer 15» and pressed Load earlier.
      log.scrollTop = 5 * ROW
      fireEvent.scroll(log)
      fireEvent.click(screen.getByRole('button', { name: 'Load earlier' }))
      expect(load).toHaveBeenCalledTimes(1)
      // While it reads, four records come and the cap drops the four oldest.
      rerender(shown(14, 24, true))
      // The window before the new start holds two lines only: the first row is still after the old one.
      rerender(shown(12, 24, false))
      expect(layout.rowOf(15)?.getBoundingClientRect().top).toBe(0)
    } finally {
      layout.restore()
    }
  })

  it('a row the cap dropped from under the anchor and Load earlier brought back stays where the reader saw it', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    // The records that come while it reads are taller: the height of the log changes before the rows on top come.
    const layout = layOut((row) => (Number(/answer (\d+)/.exec(row.textContent ?? '')?.[1]) >= 20 ? 3 * ROW : ROW))
    try {
      const load = vi.fn()
      const shown = (from: number, to: number, loading: boolean) => <Transcript events={range(from, to).map(answer)} firstIndex={from} earlier={{ load, loading }} />
      const { rerender } = render(shown(10, 20, false))
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      // The reader looks at «answer 11», which the cap drops next.
      log.scrollTop = 1 * ROW
      fireEvent.scroll(log)
      fireEvent.click(screen.getByRole('button', { name: 'Load earlier' }))
      rerender(shown(14, 24, true))
      expect(layout.rowOf(11)).toBeUndefined()
      // Ten rows come on top, «answer 11» among them: it is where the reader saw it (worfy-ui ticket 22),
      // whatever height the new records added.
      rerender(shown(4, 24, false))
      expect(layout.rowOf(11)?.getBoundingClientRect().top).toBe(0)
      expect(log.scrollTop).toBe(7 * ROW)
    } finally {
      layout.restore()
    }
  })

  it('the control above the first row: a button while there is more, disabled while it reads', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const load = vi.fn()
    const events = range(0, 3).map(answer)
    const { rerender } = render(<Transcript events={events} earlier={{ load, loading: false }} />)
    const button = screen.getByRole('button', { name: 'Load earlier' })
    expect(screen.getByTestId('transcript').firstElementChild?.contains(button)).toBe(true)
    fireEvent.click(button)
    expect(load).toHaveBeenCalledTimes(1)
    rerender(<Transcript events={events} earlier={{ load, loading: true }} />)
    expect(screen.getByTestId('transcript-load-earlier')).toHaveProperty('disabled', true)
    rerender(<Transcript events={events} />)
    expect(screen.queryByTestId('transcript-load-earlier')).toBeNull()
  })
})

describe('a main that does not know `back` (an older build on a Linked machine)', () => {
  it('is read forward to the end the old way; the newest KEEP_EVENTS events are kept, with no Load earlier', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    // No `earlier` and no `offsets`: the old main read the first chunk of the file and says there is more.
    answers.push(() => ({ found: true, events: range(0, 4000).map(answer), cursor: { offset: 400_000, fileId: FILE }, reset: false, more: true }))
    answers.push((request) => {
      expect(request).toStrictEqual({ projectRoot: ROOT, sessionId: S, cursor: { offset: 400_000, fileId: FILE }, maxBytes: WINDOW })
      return { found: true, events: range(4000, 6000).map(answer), cursor: { offset: 600_000, fileId: FILE }, reset: false, more: false }
    })
    const { hook } = await openTranscript()
    expect(requests).toHaveLength(2)
    expect(hook.result.current.events).toHaveLength(keep)
    expect(texts(hook.result.current.events)[0]).toBe(`answer ${6000 - keep}`)
    expect(texts(hook.result.current.events).at(-1)).toBe('answer 5999')
    expect(hook.result.current.earlier).toBeNull()
    expect(module.earlierControl(hook.result.current, ROOT, S)).toBeUndefined()
    // Records appended later come after the kept ones.
    answers.push((request) => {
      expect(request.cursor).toStrictEqual({ offset: 600_000, fileId: FILE })
      return { found: true, events: [answer(6000)], cursor: { offset: 600_100, fileId: FILE }, reset: false, more: false }
    })
    await transcriptChanged()
    await vi.waitFor(() => expect(texts(hook.result.current.events).at(-1)).toBe('answer 6000'))
    expect(hook.result.current.events).toHaveLength(keep)
  })

  it('reads a long file in time in proportion to its length, not to its square', { timeout: 5_000 }, async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    // 1000 chunks of 20 000 events. Kept whole until the end, the events would be copied about
    // 10^10 times (each chunk copies all read before it) and hold 20 million at once.
    const CHUNK = 20_000
    const chunk = range(0, CHUNK).map(answer)
    const last = range(1_000_000, 1_000_000 + keep).map(answer)
    let round = 0
    const next = (): Answer => {
      round += 1
      const final = round === 1000
      return { found: true, events: final ? last : chunk, cursor: { offset: round * 1000, fileId: FILE }, reset: false, more: !final }
    }
    for (let at = 0; at < 1000; at += 1) answers.push(next)
    const { hook } = await openTranscript()
    expect(requests).toHaveLength(1000)
    expect(texts(hook.result.current.events)).toEqual(range(1_000_000, 1_000_000 + keep).map((n) => `answer ${n}`))
    // Rows are counted from the start of the file, as when every event was kept until the end.
    expect(hook.result.current.first).toBe(999 * CHUNK)
    expect(hook.result.current.earlier).toBeNull()
  })

  it('keepNewest, what it holds between chunks: never more than KEEP_EVENTS, the newest, and the count of the dropped', async () => {
    const { keepNewest, KEEP_EVENTS: keep } = await import('../../src/renderer/claude-home/useClaudeHome')
    // Chunks smaller than KEEP_EVENTS (the hold fills up over several chunks) and one larger (a single
    // chunk overflows it). A few hundred thousand events are enough: 20 million made the test run out
    // of its 5 s under a loaded machine (gate full of PR #718).
    const sizes = [...Array.from({ length: 40 }, () => Math.ceil(keep / 3)), keep * 2 + 1]
    let held = { events: [] as AgentEvent[], dropped: 0 }
    let read = 0
    for (const size of sizes) {
      held = keepNewest(held, range(read, read + size).map(answer))
      read += size
      expect(held.events.length).toBeLessThanOrEqual(keep)
      expect(held.dropped + held.events.length).toBe(read)
    }
    expect(texts(held.events)).toEqual(range(read - keep, read).map((n) => `answer ${n}`))
    const few = keepNewest({ events: [answer(0)], dropped: 7 }, [answer(1)])
    expect(texts(few.events)).toEqual(['answer 0', 'answer 1'])
    expect(few.dropped).toBe(7)
  })

  it('between chunks it holds only the newest KEEP_EVENTS events: the older ones are free for the garbage collector', async () => {
    // The test above times the read and the one before checks keepNewest alone; neither sees what
    // the read holds while it waits for the next chunk. Kept whole and cut once at the end, the
    // events would give the same view, and a long file would sit in memory until the read ended.
    setFlagsFromString('--expose-gc')
    const collect = runInNewContext('gc') as () => void
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    // Three chunks of KEEP_EVENTS events each, then a fourth that waits. Once the third is read,
    // the second is older than the newest KEEP_EVENTS. The first stays out of the check: the read
    // keeps the first answer it was started with.
    let second: WeakRef<AgentEvent> | undefined
    let third: WeakRef<AgentEvent> | undefined
    const chunk = (from: number, more: boolean): Answer => ({ found: true, events: range(from, from + keep).map(answer), cursor: { offset: from + keep, fileId: FILE }, reset: false, more })
    answers.push(() => chunk(0, true))
    answers.push(() => {
      const read = chunk(keep, true)
      second = new WeakRef(read.events[0]!)
      return read
    })
    answers.push(() => {
      const read = chunk(2 * keep, true)
      third = new WeakRef(read.events[0]!)
      return read
    })
    let release: (last: Answer) => void = () => undefined
    answers.push(() => new Promise<Answer>((done) => (release = done)))
    const hook = renderHook(() => module.useSessionTranscript(ROOT, S))
    await vi.waitFor(() => expect(requests).toHaveLength(4))
    // A WeakRef keeps its target until the current job ends: collect in a later one.
    await new Promise((done) => setTimeout(done, 0))
    collect()
    expect(third?.deref(), 'the newest chunk is still held').toBeDefined()
    expect(second?.deref(), 'the chunk older than the newest KEEP_EVENTS is still held').toBeUndefined()
    release(chunk(3 * keep, false))
    await vi.waitFor(() => expect(hook.result.current.loaded).toBe(true))
    expect(texts(hook.result.current.events)).toEqual(range(3 * keep, 4 * keep).map((n) => `answer ${n}`))
    expect(hook.result.current.first).toBe(3 * keep)
  })

  it('a file replaced while it is read from its start: only the new file is shown, its rows counted from its start', async () => {
    const module = await import('../../src/renderer/claude-home/useClaudeHome')
    const keep = module.KEEP_EVENTS
    // The old file: KEEP_EVENTS + 1000 events, 1000 of them dropped by the time the file is replaced.
    answers.push(() => ({ found: true, events: range(100_000, 101_000 + keep).map(answer), cursor: { offset: 900_000, fileId: FILE }, reset: false, more: true }))
    answers.push(() => ({ found: true, events: range(0, 3000).map(answer), cursor: { offset: 300_000, fileId: 'dev:other' }, reset: true, more: true }))
    answers.push(() => ({ found: true, events: range(3000, 3000 + keep).map(answer), cursor: { offset: 800_000, fileId: 'dev:other' }, reset: false, more: false }))
    const { hook } = await openTranscript()
    expect(requests).toHaveLength(3)
    expect(texts(hook.result.current.events)).toEqual(range(3000, 3000 + keep).map((n) => `answer ${n}`))
    expect(hook.result.current.first).toBe(3000)
  })

  it('the last answer of a Session Node reads on to the end of the file', async () => {
    views = [
      { projectId: PROJECT.id, nodeId: 'live-node', sessionId: 'live-1', sdkSessionId: S, state: 'idle', error: null, cwd: ROOT, model: null, version: 1 },
    ]
    answers.push(() => ({ found: true, events: range(0, 3).map(answer), cursor: { offset: 300, fileId: FILE }, reset: false, more: true }))
    answers.push(() => ({ found: true, events: [answer(3), { type: 'notice', kind: 'user', text: 'a prompt' } as AgentEvent], cursor: { offset: 500, fileId: FILE }, reset: false, more: true }))
    answers.push(() => ({ found: true, events: [], cursor: { offset: 600, fileId: FILE }, reset: false, more: false }))
    const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
    const data = { node: { id: 'live-node', kind: 'session', data: { origin: 'worfy', sessionId: S } } }
    render(
      <ReactFlowProvider>
        <SessionNode {...({ id: 'live-node', data, selected: false } as unknown as CanvasNodeProps)} />
      </ReactFlowProvider>,
    )
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    expect((await screen.findByTestId('session-node-answer')).textContent).toBe('answer 3')
    expect(requests[1]).toStrictEqual({ projectRoot: ROOT, sessionId: S, cursor: { offset: 300, fileId: FILE }, maxBytes: WINDOW })
    expect(requests[2]).toStrictEqual({ projectRoot: ROOT, sessionId: S, cursor: { offset: 500, fileId: FILE }, maxBytes: WINDOW })
  })
})

describe('the last answer of a resumed Session Node', () => {
  it('reads only the window at the end of the transcript, once', async () => {
    views = [
      { projectId: PROJECT.id, nodeId: 'live-node', sessionId: 'live-1', sdkSessionId: S, state: 'idle', error: null, cwd: ROOT, model: null, version: 1 },
    ]
    answers.push(() => ok({ ...lines(0, 3), earlier: 12_345 }))
    const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
    const data = { node: { id: 'live-node', kind: 'session', data: { origin: 'worfy', sessionId: S } } }
    render(
      <ReactFlowProvider>
        <SessionNode {...({ id: 'live-node', data, selected: false } as unknown as CanvasNodeProps)} />
      </ReactFlowProvider>,
    )
    expect((await screen.findByTestId('session-node-answer')).textContent).toBe('answer 2')
    expect(requests).toStrictEqual([{ projectRoot: ROOT, sessionId: S, back: { bytes: WINDOW } }])
  })
})

describe('drawing only the rows around the visible part (worfy-ui ticket 22)', () => {
  /** The gap between rows in the layouts below, as `.w-tr` has one. */
  const GAP = 8
  const call = (id: string): AgentEvent => ({ type: 'tool_use', id, name: 'Read', input: { file_path: `/x/${id}` }, parentToolUseId: null })

  it('chooses the rows that cover the visible part and OVERSCAN px around it, at most MAX_DRAWN', async () => {
    const { MAX_DRAWN, OVERSCAN, rowWindow, spanOf, stepOf } = await import('../../src/renderer/session/fold')
    const rows = (count: number, size: number) => Array.from({ length: count }, () => size)
    // A row takes its height and the gap after it; a row that draws nothing takes neither.
    expect(stepOf(100, 8)).toBe(108)
    expect(stepOf(0, 8)).toBe(0)
    expect(spanOf([100, 0, 100], 8, 0, 3)).toBe(208)
    expect(spanOf([100, 0, 100], 8, 1, 2)).toBe(0)
    // At the bottom: the last rows that fill 300 px and OVERSCAN more.
    expect(rowWindow(rows(1000, 50), 0, -1, 0, 300)).toStrictEqual({ start: 1000 - (300 + OVERSCAN) / 50, end: 1000 })
    // The gap between rows counts: 120 px a row.
    expect(rowWindow(rows(1000, 100), 20, -1, 0, 300)).toStrictEqual({ start: 1000 - Math.ceil((300 + OVERSCAN) / 120), end: 1000 })
    // Row 500 at the top: OVERSCAN px above it, the visible part and OVERSCAN px below.
    expect(rowWindow(rows(1000, 100), 0, 500, 0, 300)).toStrictEqual({ start: 500 - OVERSCAN / 100, end: 500 + (300 + OVERSCAN) / 100 })
    // Its top 200 px below the top of the log: 200 px more above it, 200 px less below.
    expect(rowWindow(rows(1000, 100), 0, 500, 200, 300)).toStrictEqual({ start: 500 - (OVERSCAN + 200) / 100, end: 500 + (300 + OVERSCAN - 200) / 100 })
    // Its top past the visible part and OVERSCAN: it is drawn all the same, and the rows above it.
    expect(rowWindow(rows(1000, 100), 0, 500, 5000, 300)).toStrictEqual({ start: 500 - (OVERSCAN + 5000) / 100, end: 501 })
    // Rows that draw nothing would all fit: no more than MAX_DRAWN of them, a quarter above the reader's row.
    expect(rowWindow(rows(1000, 0), 8, -1, 0, 300)).toStrictEqual({ start: 1000 - MAX_DRAWN, end: 1000 })
    expect(rowWindow(rows(1000, 0), 8, 500, 0, 300)).toStrictEqual({ start: 500 - Math.floor(MAX_DRAWN / 4), end: 500 - Math.floor(MAX_DRAWN / 4) + MAX_DRAWN })
  })

  it('draws the newest rows first, before anything is measured', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const { FIRST_DRAWN, OVERSCAN, ROW_ESTIMATE } = await import('../../src/renderer/session/fold')
    const { renderToStaticMarkup } = await import('react-dom/server')
    // The first frame, before any effect: FIRST_DRAWN rows and the space of the others.
    const first = document.createElement('div')
    first.innerHTML = renderToStaticMarkup(<Transcript events={range(0, 400).map(answer)} />)
    const log = first.querySelector('[data-testid="transcript"]')!
    expect(log.querySelectorAll(':scope > [data-item]')).toHaveLength(FIRST_DRAWN)
    expect(log.querySelector<HTMLElement>(':scope > [data-space]')?.style.height).toBe(`${(400 - FIRST_DRAWN) * ROW_ESTIMATE}px`)
    // Then, with no height measured (a hidden log): a window's height of rows at ROW_ESTIMATE each.
    render(<Transcript events={range(0, 400).map(answer)} />)
    const drawnCount = Math.ceil((window.innerHeight + OVERSCAN) / ROW_ESTIMATE)
    const shown = screen.getByTestId('transcript')
    expect(shown.querySelectorAll(':scope > [data-item]')).toHaveLength(drawnCount)
    expect(shown.querySelector<HTMLElement>(':scope > [data-space]')?.style.height).toBe(`${(400 - drawnCount) * ROW_ESTIMATE}px`)
    expect(shown.lastElementChild?.textContent).toContain('answer 399')
  })

  it('draws the rows in sight of a long transcript, the others as space, and keeps the reader’s row where it is', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const { DRAW_ALL_UP_TO, MAX_DRAWN } = await import('../../src/renderer/session/fold')
    const layout = layOut(() => ROW, GAP)
    try {
      const { rerender } = render(<Transcript events={range(0, 400).map(answer)} />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={range(0, 401).map(answer)} />)
      // At the bottom: the newest rows, not the oldest; the log is as tall as all of them.
      expect(layout.rows().length).toBeLessThanOrEqual(MAX_DRAWN)
      expect(layout.rows().length).toBeLessThan(DRAW_ALL_UP_TO)
      expect(layout.rowOf(400)).toBeDefined()
      expect(layout.rowOf(3)).toBeUndefined()
      expect(log.scrollHeight).toBe(401 * ROW + 400 * GAP)
      expect(log.scrollTop).toBe(log.scrollHeight)
      // Up the log, 37 px into «answer 3»: the rows there are drawn in place of their space, the newest are space now.
      scrollToAnswer(log, layout, 3)
      log.scrollTop += 37
      fireEvent.scroll(log)
      expect(layout.rowOf(400)).toBeUndefined()
      expect(log.scrollHeight).toBe(401 * ROW + 400 * GAP)
      expect(log.scrollTop).toBe(3 * (ROW + GAP) + 37)
      // A new row at the bottom: the reader's row stays 37 px above the top.
      rerender(<Transcript events={range(0, 402).map(answer)} />)
      expect(layout.rowOf(3)?.getBoundingClientRect().top).toBe(-37)
      // A scroll into the space of the rows not drawn, 37 px into «answer 250»: that row is drawn there.
      log.scrollTop = 250 * (ROW + GAP) + 37
      fireEvent.scroll(log)
      expect(layout.rowOf(250)?.getBoundingClientRect().top).toBe(-37)
      expect(layout.rowOf(3)).toBeUndefined()
      // A short transcript is drawn whole.
      rerender(<Transcript events={range(0, DRAW_ALL_UP_TO).map(answer)} />)
      expect(layout.rows()).toHaveLength(DRAW_ALL_UP_TO)
      expect(log.querySelector('[data-space]')).toBeNull()
    } finally {
      layout.restore()
    }
  })

  it('Load earlier that joins the first row, a run of tool calls, with an earlier call keeps the row after it in place', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    // The window starts with a tool call; the window before it ends with another, so the two join
    // into one row, which takes the key of the earlier call.
    const before = [...range(0, 10).map(answer), call('A')]
    const shown = [call('B'), ...range(10, 200).map(answer)]
    const load = vi.fn()
    const layout = layOut(() => ROW, GAP)
    try {
      const view = (events: AgentEvent[], first: number, loading: boolean) => <Transcript events={events} firstIndex={first} earlier={{ load, loading }} />
      const { rerender } = render(view(shown, 11, false))
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(view(shown, 11, false))
      log.scrollTop = 0
      fireEvent.scroll(log)
      const top = layout.rowOf(10)?.getBoundingClientRect().top
      expect(top).toBe(ROW + GAP)
      fireEvent.click(screen.getByTestId('transcript-load-earlier'))
      rerender(view(shown, 11, true))
      rerender(view([...before, ...shown], 0, true))
      rerender(view([...before, ...shown], 0, false))
      fireEvent.scroll(log)
      expect(layout.rowOf(10)?.getBoundingClientRect().top).toBe(top)
      expect(layout.rowOf(9)).toBeDefined()
    } finally {
      layout.restore()
    }
  })

  it('a line the reader opened is open again when its row is drawn again; another stays closed', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const thought = (text: string, id: string): AgentEvent => ({ type: 'thinking', text, messageId: id, parentToolUseId: null })
    const events = [...range(0, 5).map(answer), thought('an old plan', 't1'), ...range(5, 300).map(answer), thought('a plan', 't2'), answer(300)]
    const layout = layOut(() => ROW, GAP)
    try {
      const { rerender } = render(<Transcript events={events.slice(0, -1)} />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={events} />)
      const lines = () => screen.queryAllByRole('button', { name: 'Thinking' })
      expect(lines()).toHaveLength(1)
      fireEvent.click(lines()[0]!)
      expect(lines()[0]?.getAttribute('aria-expanded')).toBe('true')
      // Far up: the open line is not drawn; the old one is, closed.
      scrollToAnswer(log, layout, 3)
      expect(screen.queryByText('a plan')).toBeNull()
      expect(lines()).toHaveLength(1)
      expect(lines()[0]?.getAttribute('aria-expanded')).toBe('false')
      // Back at the bottom: the line the reader opened is open.
      log.scrollTop = log.scrollHeight - 300
      fireEvent.scroll(log)
      expect(lines()).toHaveLength(1)
      expect(lines()[0]?.getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByText('a plan')).toBeDefined()
    } finally {
      layout.restore()
    }
  })

  it('draws the row of find’s current match a third of the way down when it is not drawn, and paints the match', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const { HIGHLIGHT, partId } = await import('../../src/renderer/session/transcript-find')
    const registry = new Map<string, { ranges: Range[] }>()
    class Highlight {
      ranges: Range[]
      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    const page = globalThis as { CSS?: unknown; Highlight?: unknown }
    page.CSS = { highlights: registry }
    page.Highlight = Highlight
    const layout = layOut(() => ROW, GAP)
    try {
      const events = range(0, 401).map(answer)
      const { rerender } = render(<Transcript events={events.slice(0, -1)} />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={events} />)
      expect(layout.rowOf(3)).toBeUndefined()
      const part = partId('e3', 'text')
      rerender(<Transcript events={events} find={{ needle: 'answer 3', parts: new Set([part]), current: { row: 'e3', part, occurrence: 0, reveal: null }, seq: 1 }} />)
      // A third of the 300 px log down; the match is in sight there, so find scrolls no further.
      expect(layout.rowOf(3)?.getBoundingClientRect().top).toBe(100)
      const [range3] = registry.get(HIGHLIGHT.current)?.ranges ?? []
      expect(range3?.toString()).toBe('answer 3')
      expect(layout.rowOf(3)?.contains(range3!.startContainer)).toBe(true)
    } finally {
      layout.restore()
      delete page.CSS
      delete page.Highlight
    }
  })

  it('keeps the reader’s row through a time with the log hidden, and draws for its height once shown', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const observers: (() => void)[] = []
    const globals = globalThis as { ResizeObserver?: unknown }
    const had = globals.ResizeObserver
    globals.ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    }
    const layout = layOut()
    try {
      const { rerender } = render(<Transcript events={range(0, 400).map(answer)} />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={range(0, 401).map(answer)} />)
      scrollToAnswer(log, layout, 200)
      log.scrollTop += 37
      fireEvent.scroll(log)
      // The Canvas comes on screen: the log has no height; new rows come, a scroll event too.
      layout.hide()
      fireEvent.scroll(log)
      rerender(<Transcript events={range(0, 402).map(answer)} />)
      rerender(<Transcript events={range(0, 403).map(answer)} />)
      // With no height to measure, a window's height of rows is drawn below the reader's.
      expect(layout.rowOf(215)).toBeDefined()
      // Shown again: the reader's row is where it was, and the rows drawn are for the log's 300 px.
      layout.show()
      act(() => observers.forEach((callback) => callback()))
      expect(layout.rowOf(200)?.getBoundingClientRect().top).toBe(-37)
      expect(layout.rowOf(215)).toBeUndefined()
      expect(layout.rowOf(402)).toBeUndefined()
    } finally {
      layout.restore()
      globals.ResizeObserver = had
    }
  })

  it('an open question card stays drawn while the reader scrolls far from it: the choice is kept, the focus is not taken again', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const question: AgentEvent = {
      type: 'question_request',
      requestId: 'q-far',
      toolUseId: null,
      questions: [{ question: 'Which database?', header: 'Database', multiSelect: false, options: [{ label: 'Postgres', description: 'The server', preview: null }, { label: 'SQLite', description: 'A file', preview: null }] }],
    }
    const events = [...range(0, 300).map(answer), question, answer(300)]
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const layout = layOut(() => ROW, GAP)
    try {
      const { rerender } = render(<Transcript events={events.slice(0, -1)} sessionId="live-1" />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={events} sessionId="live-1" />)
      const option = () => screen.getByRole('radio', { name: /Postgres/ })
      const card = option().closest('[data-item]')
      fireEvent.click(option())
      expect(option().getAttribute('aria-checked')).toBe('true')
      scrollToAnswer(log, layout, 3)
      expect(layout.rowOf(299)).toBeUndefined()
      // Far up, the card is still there, the same element; back at the bottom, Postgres is still chosen.
      expect(option().closest('[data-item]')).toBe(card)
      log.scrollTop = log.scrollHeight - 300
      fireEvent.scroll(log)
      expect(option().getAttribute('aria-checked')).toBe('true')
      expect(option().closest('[data-item]')).toBe(card)
      // The card took the focus once, when it came, without scrolling the log to it.
      for (const call of focus.mock.calls) expect(call[0]).toStrictEqual({ preventScroll: true })
      expect(focus.mock.calls.length).toBeLessThanOrEqual(1)
    } finally {
      layout.restore()
      focus.mockRestore()
    }
  })
})

describe('the reader’s row and the rows kept drawn, review round 2 (worfy-ui ticket 22)', () => {
  const call = (id: string): AgentEvent => ({ type: 'tool_use', id, name: 'Read', input: { file_path: `/x/${id}` }, parentToolUseId: null })
  const older = (n: number): AgentEvent => ({ type: 'text', text: `older ${n}`, messageId: `o${n}`, parentToolUseId: null, synthetic: false })
  /** A call line is 30 px: a run of tool calls is 30 px a call; any other row ROW. */
  const callHeight = (row: Element): number => {
    const calls = row.querySelectorAll('[data-testid="tool-call"]').length
    return calls > 0 ? 30 * calls : ROW
  }

  it('rowFor: the row that holds a gone row’s event, else the first one', async () => {
    const { foldTranscript, rowFor } = await import('../../src/renderer/session/fold')
    const rows = foldTranscript([answer(0), call('A'), call('B'), answer(1)], new Set(), 14)
    expect(rows.map((row) => row.key)).toStrictEqual(['e14', 'e15', 'e17'])
    // e16 (the call B) is in the run that starts at e15.
    expect(rowFor(rows, 'e16')).toBe(1)
    // e11 was dropped by the cap: the first row stands for it.
    expect(rowFor(rows, 'e11')).toBe(0)
    expect(rowFor([], 'e11')).toBe(-1)
  })

  for (const [name, shownCount, olderCount] of [
    ['a short transcript', 40, 10],
    ['a long one', 300, 300],
  ] as const) {
    it(`Load earlier that joins 20 calls to the first row, a run of tool calls, keeps the row after it in place: ${name}`, async () => {
      const { Transcript } = await import('../../src/renderer/session/Transcript')
      const before = [...range(0, olderCount).map(older), ...range(0, 20).map((n) => call(`A${n}`))]
      const shown = [call('B'), ...range(10, 10 + shownCount).map(answer)]
      const load = vi.fn()
      const layout = layOut(callHeight, 8)
      try {
        const view = (events: AgentEvent[], first: number, loading: boolean) => <Transcript events={events} firstIndex={first} earlier={{ load, loading }} />
        const { rerender } = render(view(shown, before.length, false))
        const log = screen.getByTestId('transcript')
        layout.attach(log)
        rerender(view(shown, before.length, false))
        log.scrollTop = 0
        fireEvent.scroll(log)
        const top = layout.rowOf(10)?.getBoundingClientRect().top
        expect(top).toBe(30 + 8)
        fireEvent.click(screen.getByTestId('transcript-load-earlier'))
        rerender(view(shown, before.length, true))
        rerender(view([...before, ...shown], 0, true))
        rerender(view([...before, ...shown], 0, false))
        fireEvent.scroll(log)
        // The run is 21 calls now, 630 px; «answer 10» right after it is where the reader saw it.
        expect(layout.rowOf(10)?.previousElementSibling?.querySelectorAll('[data-testid="tool-call"]')).toHaveLength(21)
        expect(layout.rowOf(10)?.getBoundingClientRect().top).toBe(top)
      } finally {
        layout.restore()
      }
    })
  }

  it('a scroll half way into the space above, after a drawn row grew with no render, lands half way down the log', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    let grown = 0
    const layout = layOut((row) => (row.textContent?.includes('answer 399') === true ? ROW + grown : ROW))
    try {
      const { rerender } = render(<Transcript events={range(0, 399).map(answer)} />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={range(0, 400).map(answer)} />)
      // A tool output opened in the newest row: 2000 px more, and no render of the Transcript.
      grown = 2000
      const space = log.querySelector<HTMLElement>(':scope > [data-space]')!
      log.scrollTop = Number.parseFloat(space.style.height) / 2
      const asked = log.scrollTop / log.scrollHeight
      fireEvent.scroll(log)
      expect(Math.abs(log.scrollTop / log.scrollHeight - asked)).toBeLessThan(0.02)
    } finally {
      layout.restore()
    }
  })

  it('keeps an open card drawn above the drawn rows, and not a card already answered', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const ask = (requestId: string): AgentEvent => ({
      type: 'question_request',
      requestId,
      toolUseId: null,
      questions: [{ question: `Which one, ${requestId}?`, header: 'Pick', multiSelect: false, options: [{ label: 'One', description: 'one', preview: null }, { label: 'Two', description: 'two', preview: null }] }],
    })
    const done: AgentEvent = { type: 'question_resolved', requestId: 'q-done', outcome: 'answered', answers: {} }
    // e5 an open question, e7 an answered one, far above the newest rows.
    const events = [...range(0, 5).map(answer), ask('q-open'), answer(5), ask('q-done'), ...range(6, 300).map(answer), done, answer(300)]
    const layout = layOut()
    try {
      const { rerender } = render(<Transcript events={events.slice(0, -1)} sessionId="live-2" />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={events} sessionId="live-2" />)
      expect(layout.rowOf(6)).toBeUndefined()
      expect(log.querySelector('[data-item="e5"]')).not.toBeNull()
      expect(log.querySelector('[data-item="e7"]')).toBeNull()
    } finally {
      layout.restore()
    }
  })

  it('find with a current row the rows do not have leaves the reader at the bottom', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const layout = layOut()
    try {
      const events = range(0, 401).map(answer)
      const { rerender } = render(<Transcript events={events.slice(0, -1)} />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={events} />)
      rerender(<Transcript events={events} find={{ needle: 'answer', parts: new Set(['e9999:text']), current: { row: 'e9999', part: 'e9999:text', occurrence: 0, reveal: null }, seq: 1 }} />)
      expect(log.scrollTop).toBe(log.scrollHeight)
      expect(layout.rowOf(400)).toBeDefined()
    } finally {
      layout.restore()
    }
  })

  it('a log shown again after the browser dropped its scroll offset puts the reader’s row back, with no rows to draw anew', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const observers: (() => void)[] = []
    const globals = globalThis as { ResizeObserver?: unknown }
    const had = globals.ResizeObserver
    globals.ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    }
    const height = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    // A window as tall as the log: hidden or shown, the same rows are drawn, so no render follows the show.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    const layout = layOut()
    try {
      const { rerender } = render(<Transcript events={range(0, 400).map(answer)} />)
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      rerender(<Transcript events={range(0, 401).map(answer)} />)
      scrollToAnswer(log, layout, 200)
      log.scrollTop += 37
      fireEvent.scroll(log)
      layout.hide()
      rerender(<Transcript events={range(0, 401).map(answer)} />)
      const drawnBefore = layout.rows().map((row) => row.getAttribute('data-item'))
      layout.show(true)
      act(() => observers.forEach((callback) => callback()))
      expect(layout.rows().map((row) => row.getAttribute('data-item'))).toStrictEqual(drawnBefore)
      expect(layout.rowOf(200)?.getBoundingClientRect().top).toBe(-37)
    } finally {
      layout.restore()
      globals.ResizeObserver = had
      if (height !== undefined) Object.defineProperty(window, 'innerHeight', height)
    }
  })
})

describe('a reader’s row the cap dropped while Load earlier reads (worfy-ui ticket 22)', () => {
  it('the first row stands in for it at its offset, whatever its height, until the row comes back', async () => {
    const { Transcript } = await import('../../src/renderer/session/Transcript')
    const call = (id: string): AgentEvent => ({ type: 'tool_use', id, name: 'Read', input: { file_path: `/x/${id}` }, parentToolUseId: null })
    // Event n: «answer n», but events 14–16 are three tool calls, one 90 px row.
    const event = (n: number): AgentEvent => (n >= 14 && n <= 16 ? call(`c${n}`) : answer(n))
    const layout = layOut((row) => (row.querySelectorAll('[data-testid="tool-call"]').length > 0 ? 90 : ROW))
    try {
      const load = vi.fn()
      const shown = (from: number, to: number, loading: boolean) => <Transcript events={range(from, to).map(event)} firstIndex={from} earlier={{ load, loading }} />
      const { rerender } = render(shown(10, 30, false))
      const log = screen.getByTestId('transcript')
      layout.attach(log)
      // The reader looks at «answer 11» and presses Load earlier; the cap drops the rows before the calls.
      log.scrollTop = 1 * ROW
      fireEvent.scroll(log)
      fireEvent.click(screen.getByRole('button', { name: 'Load earlier' }))
      rerender(shown(14, 34, true))
      expect(layout.rowOf(11)).toBeUndefined()
      // The run of calls, the first row now, is where «answer 11» was: at the top.
      expect(log.querySelector('[data-item="e14"]')?.getBoundingClientRect().top).toBe(0)
      rerender(shown(4, 34, false))
      expect(layout.rowOf(11)?.getBoundingClientRect().top).toBe(0)
    } finally {
      layout.restore()
    }
  })
})
