// The renderer's copy of a Project's Sessions (src/renderer/claude-home/useClaudeHome.ts): when the
// history, which holds the titles, is read again. The registry file of a terminal Session can
// appear before its first prompt creates the transcript; the title must still show up once the
// transcript is written, without one history read per transcript change.
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
let changed: ((payload: unknown) => void) | undefined
const asked: string[] = []

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  asked.length = 0
  history = []
  changed = undefined
  const bridge = {
    invoke: (channel: string) => {
      asked.push(channel)
      if (channel === 'claudeHome.sessions') return Promise.resolve({ ok: true, value: { live, history } })
      if (channel === 'claudeHome.live') return Promise.resolve({ ok: true, value: { live } })
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
  const { useClaudeHome, LIVE_POLL_MS } = await import('../../src/renderer/claude-home/useClaudeHome')
  const hook = renderHook(() => useClaudeHome(ROOT))
  await vi.waitFor(() => expect(hook.result.current.live).toEqual(live))
  const poll = async () => act(async () => await vi.advanceTimersByTimeAsync(LIVE_POLL_MS))
  const transcriptChanged = async () => act(async () => changed?.({ projectRoot: ROOT, sessions: false, transcripts: [S] }))
  return { hook, poll, transcriptChanged }
}

describe('useClaudeHome: titles of live Sessions', () => {
  it('reads the history again after the transcript of an untitled live Session changes, once per poll', async () => {
    const { hook, poll, transcriptChanged } = await mount()
    // The live Session is new to the renderer: one more history read, then no more on later polls.
    await poll()
    await poll()
    expect(historyReads()).toBe(2)

    // The first prompt creates the transcript; two changes before the next poll give one read.
    history = titled('First prompt')
    await transcriptChanged()
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(hook.result.current.history).toEqual(titled('First prompt')))
    expect(historyReads()).toBe(3)

    // The title is known: later transcript changes do not read the history again.
    await transcriptChanged()
    await poll()
    await poll()
    expect(historyReads()).toBe(3)
  })

  it('keeps asking on transcript changes while the transcript has no title yet', async () => {
    const { hook, poll, transcriptChanged } = await mount()
    await poll()
    history = titled(undefined)
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(historyReads()).toBe(3))
    history = titled('Typed later')
    await transcriptChanged()
    await poll()
    await vi.waitFor(() => expect(hook.result.current.history).toEqual(titled('Typed later')))
    expect(historyReads()).toBe(4)
  })
})
