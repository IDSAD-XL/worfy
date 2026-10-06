// The renderer's copy of a Project's Sessions (src/renderer/claude-home/useClaudeHome.ts): when the
// history, which holds the titles, is read again. The registry file of a terminal Session can
// appear before its first prompt creates the transcript; the title must still show up once the
// transcript is written, without one history read per transcript change. A Session that appears
// is read once, and an older answer never overwrites a newer one.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { HistorySession, LiveSession } from '../../src/shared/ipc/claude-home'

const ROOT = '/Users/test/projects/demo'
const S = 'cccccccc-0000-4000-8000-000000000003'

const live: LiveSession[] = [{ pid: 100, sessionId: S, cwd: ROOT, status: 'idle', entrypoint: 'cli' }]
const titled = (title: string | undefined): HistorySession[] => [
  { sessionId: S, ...(title === undefined ? {} : { title }), size: 10, modifiedAt: 1, live: true },
]

let history: HistorySession[]
let liveNow: LiveSession[]
let changed: ((payload: unknown) => void) | undefined
const asked: string[] = []
/** While set, `claudeHome.sessions` answers wait here until the test resolves them. */
let held: { resolve: () => void }[] | undefined
/** The same for `claudeHome.live`. */
let heldLive: { resolve: () => void }[] | undefined

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  asked.length = 0
  history = []
  liveNow = live
  changed = undefined
  held = undefined
  heldLive = undefined
  const bridge = {
    invoke: (channel: string) => {
      asked.push(channel)
      if (channel === 'claudeHome.sessions') {
        // The answer is what main read when the request came in, however late it arrives.
        const value = { live: liveNow, history }
        if (held === undefined) return Promise.resolve({ ok: true, value })
        const queue = held
        return new Promise((resolve) => queue.push({ resolve: () => resolve({ ok: true, value }) }))
      }
      if (channel === 'claudeHome.live') {
        const value = { live: liveNow }
        if (heldLive === undefined) return Promise.resolve({ ok: true, value })
        const queue = heldLive
        return new Promise((resolve) => queue.push({ resolve: () => resolve({ ok: true, value }) }))
      }
      return Promise.resolve({ ok: true, value: { closed: true } })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      if (channel === 'claudeHome.changed') changed = handler
      return 1
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const historyReads = () => asked.filter((channel) => channel === 'claudeHome.sessions').length

async function mount() {
  const { useClaudeHome, refreshClaudeHome, LIVE_POLL_MS } = await import('../../src/renderer/claude-home/useClaudeHome')
  const hook = renderHook(() => useClaudeHome(ROOT))
  await vi.waitFor(() => expect(hook.result.current.live).toEqual(liveNow))
  const poll = async () => act(async () => await vi.advanceTimersByTimeAsync(LIVE_POLL_MS))
  const transcriptChanged = async () => act(async () => changed?.({ projectRoot: ROOT, sessions: false, transcripts: [S] }))
  const registryChanged = async () => act(async () => changed?.({ projectRoot: ROOT, sessions: true, transcripts: [] }))
  const refresh = async () => act(async () => refreshClaudeHome(ROOT))
  return { hook, poll, transcriptChanged, registryChanged, refresh }
}

/** Lets pending promise callbacks run. */
const settle = async () => act(async () => await Promise.resolve())

describe('useClaudeHome: titles of live Sessions', () => {
  it('reads the history again after the transcript of an untitled live Session changes, once per poll', async () => {
    const { hook, poll, transcriptChanged } = await mount()
    // The first read already had the live Session: polls do not read the history for it again.
    await poll()
    await poll()
    expect(historyReads()).toBe(1)

    // The first prompt creates the transcript; two changes before the next poll give one read.
    history = titled('First prompt')
    await transcriptChanged()
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(hook.result.current.history).toEqual(titled('First prompt')))
    expect(historyReads()).toBe(2)

    // The title is known: later transcript changes do not read the history again.
    await transcriptChanged()
    await poll()
    await poll()
    expect(historyReads()).toBe(2)
  })

  it('keeps asking on transcript changes while the transcript has no title yet', async () => {
    const { hook, poll, transcriptChanged } = await mount()
    await poll()
    history = titled(undefined)
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(historyReads()).toBe(2))
    history = titled('Typed later')
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(hook.result.current.history).toEqual(titled('Typed later')))
    expect(historyReads()).toBe(3)
  })
})

describe('useClaudeHome: which transcript changes read the history', () => {
  const T = 'dddddddd-0000-4000-8000-000000000004'
  const transcriptOf = async (sessionId: string) => act(async () => changed?.({ projectRoot: ROOT, sessions: false, transcripts: [sessionId] }))

  it('a transcript change is answered by one poll, not by every poll after it', async () => {
    const { poll, transcriptChanged } = await mount()
    history = titled(undefined)
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(historyReads()).toBe(2))
    await poll()
    await poll()
    expect(historyReads()).toBe(2)
  })

  it('does not read the history for a changed transcript of a Session that is not live at the poll', async () => {
    // T is in the history without a title and is not live; S keeps the poll going.
    history = [...titled(undefined), { sessionId: T, size: 10, modifiedAt: 1, live: false }]
    const { poll } = await mount()
    await transcriptOf(T)
    await poll()
    await poll()
    expect(historyReads()).toBe(1)
  })

  it('does not read the history for a Session the registry names, though its transcript changed before it was listed live', async () => {
    liveNow = []
    history = titled(undefined)
    const { hook, transcriptChanged, registryChanged } = await mount()
    expect(historyReads()).toBe(1)
    await transcriptChanged()
    liveNow = [{ ...live[0]!, name: 'named in the registry' }]
    await registryChanged()
    await vi.waitFor(() => expect(hook.result.current.live).toEqual(liveNow))
    await settle()
    expect(historyReads()).toBe(1)
  })

  it('does not keep a transcript change that came while the registry named the Session', async () => {
    liveNow = [{ ...live[0]!, name: 'named in the registry' }]
    history = titled(undefined)
    const { hook, poll, transcriptChanged } = await mount()
    await transcriptChanged()
    // The registry drops the name before the next poll; the change came while it was named.
    liveNow = live
    await poll()
    await vi.waitFor(() => expect(hook.result.current.live).toEqual(live))
    await settle()
    expect(historyReads()).toBe(1)
    // A change after that is kept and read on the next poll.
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(historyReads()).toBe(2))
  })
})

describe('useClaudeHome: one history read per new Session', () => {
  it('reads the history once when a Session appears in the registry, and the title after its first prompt', async () => {
    liveNow = []
    const { hook, poll, transcriptChanged, registryChanged } = await mount()
    expect(historyReads()).toBe(1)

    // Claude Code writes the registry file before the first prompt creates the transcript.
    liveNow = live
    await registryChanged()
    await vi.waitFor(() => expect(hook.result.current.live).toEqual(live))
    await vi.waitFor(() => expect(historyReads()).toBe(2))
    await poll()
    await poll()
    expect(historyReads()).toBe(2)

    history = titled('First prompt')
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(hook.result.current.history).toEqual(titled('First prompt')))
    expect(historyReads()).toBe(3)
  })

  it('does not read the history again for a Session the last history read already had', async () => {
    liveNow = []
    const { hook, poll, refresh } = await mount()
    // The Session shows up through a full read (here the history popover's refresh) first.
    liveNow = live
    await refresh()
    await vi.waitFor(() => expect(hook.result.current.live).toEqual(live))
    expect(historyReads()).toBe(2)
    await poll()
    await poll()
    expect(historyReads()).toBe(2)
  })

  it('still gets the title when the first prompt lands before the answer that lists the Session as live', async () => {
    liveNow = []
    const { hook, poll, transcriptChanged, refresh } = await mount()
    const answers: { resolve: () => void }[] = []
    held = answers
    liveNow = live
    // Main reads the registry and the history before the first prompt creates the transcript...
    await refresh()
    // ...and the transcript change reaches the renderer before that answer does.
    history = titled('First prompt')
    held = undefined
    await transcriptChanged()
    expect(hook.result.current.live).toEqual([])
    asked.length = 0
    await act(async () => {
      for (const answer of answers) answer.resolve()
    })
    await vi.waitFor(() => expect(hook.result.current.live).toEqual(live))
    expect(hook.result.current.history).toEqual([])
    await poll()
    await vi.waitFor(() => expect(hook.result.current.history).toEqual(titled('First prompt')))
    expect(historyReads()).toBe(1)
  })
})

describe('useClaudeHome: answers out of order', () => {
  it('keeps the answer of the latest claudeHome.sessions request when an older one arrives after it', async () => {
    const { hook, refresh } = await mount()
    held = []
    history = titled('Old')
    await refresh()
    history = titled('New')
    await refresh()
    expect(held).toHaveLength(2)
    const [older, newer] = held
    newer!.resolve()
    await vi.waitFor(() => expect(hook.result.current.history).toEqual(titled('New')))
    older!.resolve()
    await settle()
    await settle()
    expect(hook.result.current.history).toEqual(titled('New'))
  })

  it('does not let an older claudeHome.sessions answer bring back a Session a newer live list dropped', async () => {
    const { hook, refresh, registryChanged } = await mount()
    held = []
    await refresh()
    // The Session ends while the full read is still on its way.
    liveNow = []
    await registryChanged()
    await vi.waitFor(() => expect(hook.result.current.live).toEqual([]))
    held[0]!.resolve()
    await settle()
    await settle()
    expect(hook.result.current.live).toEqual([])
  })

  it('does not let an older claudeHome.live answer bring back a Session a newer full read dropped', async () => {
    const { hook, refresh, registryChanged } = await mount()
    const answers: { resolve: () => void }[] = []
    heldLive = answers
    await registryChanged()
    expect(answers).toHaveLength(1)
    // The Session ends; a full read asked after the live one answers first.
    liveNow = []
    await refresh()
    await vi.waitFor(() => expect(hook.result.current.live).toEqual([]))
    answers[0]!.resolve()
    await settle()
    await settle()
    expect(hook.result.current.live).toEqual([])
  })
})
