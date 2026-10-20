// The renderer's store of Subagent trees (ticket 15, src/renderer/claude-home/subagents.ts): when
// the list of Sessions on the Canvas changes, a Session that stays in the list keeps its tree and
// its reader, and is not asked again; a Session that leaves the list is released. The files are
// asked again every POLL_MS while a Subagent runs, by the files or by a live Session's events.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { SubagentSignal } from '../../src/shared/transcript/subagents'

const ROOT = '/Users/test/projects/demo'
const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'

/** A running Subagent of the Session: one Agent call without a result. */
const running = (sessionId: string): SubagentSignal[] => [
  { kind: 'call', toolUseId: `toolu_${sessionId.slice(0, 4)}`, at: 1000, parentToolUseId: null, subagentType: 'scout', description: null, name: null, model: null, background: false },
]

let asked: Array<{ channel: string; input: unknown }>
let changed: ((payload: unknown) => void) | undefined
/** What main answers for a Session's files; by default, a running Subagent. */
let filesOf: (sessionId: string) => { signals: SubagentSignal[]; files: []; found: boolean }

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  asked = []
  changed = undefined
  filesOf = (sessionId) => ({ signals: running(sessionId), files: [], found: true })
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      if (channel === 'claudeHome.subagents') {
        const { sessionId } = input as { sessionId: string }
        return Promise.resolve({ ok: true, value: filesOf(sessionId) })
      }
      if (channel === 'claudeHome.sessions') return Promise.resolve({ ok: true, value: { live: [], history: [] } })
      if (channel === 'claudeHome.live') return Promise.resolve({ ok: true, value: { live: [] } })
      return Promise.resolve({ ok: true, value: {} })
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

const readsOf = (sessionId: string) => asked.filter(({ channel, input }) => channel === 'claudeHome.subagents' && (input as { sessionId: string }).sessionId === sessionId).length

async function mount(ids: string[]) {
  const store = await import('../../src/renderer/claude-home/subagents')
  const hook = renderHook(({ list }: { list: string[] }) => store.useSubagentTrees(ROOT, list), { initialProps: { list: ids } })
  return { hook, store }
}

describe('useSubagentTrees: the list of Sessions changes', () => {
  it('keeps the tree of a Session that stays in the list and does not ask for it again', async () => {
    const { hook } = await mount([A])
    await vi.waitFor(() => expect(hook.result.current.get(A)).toHaveLength(1))
    expect(readsOf(A)).toBe(1)

    act(() => hook.rerender({ list: [A, B] }))
    // No frame without the tree of A while B is read.
    expect(hook.result.current.get(A)).toHaveLength(1)
    await vi.waitFor(() => expect(hook.result.current.get(B)).toHaveLength(1))
    expect(hook.result.current.get(A)).toHaveLength(1)
    expect(readsOf(A)).toBe(1)
    expect(readsOf(B)).toBe(1)

    // A is still watched: a change of its transcript reads it again.
    await act(async () => changed?.({ projectRoot: ROOT, sessions: false, transcripts: [A] }))
    await vi.waitFor(() => expect(readsOf(A)).toBe(2))
  })

  it('releases a Session that leaves the list, and every Session on unmount', async () => {
    const { hook, store } = await mount([A, B])
    await vi.waitFor(() => expect(hook.result.current.size).toBe(2))

    await act(async () => hook.rerender({ list: [B] }))
    expect(Object.keys(store.useSubagentsStore.getState().bySession)).toEqual([`${ROOT}\0${B}`])
    await act(async () => changed?.({ projectRoot: ROOT, sessions: false, transcripts: [A] }))
    expect(readsOf(A)).toBe(1)

    await act(async () => hook.unmount())
    expect(store.useSubagentsStore.getState().bySession).toEqual({})
    await act(async () => changed?.({ projectRoot: ROOT, sessions: false, transcripts: [B] }))
    expect(readsOf(B)).toBe(1)
  })
})

describe('useSubagentTrees: asking the files again while a Subagent runs', () => {
  /** A live Session of worfy whose Orchestrator called a Subagent, and maybe got its result. */
  async function live(sessionId: string, result: boolean) {
    const { useSessionLogs } = await import('../../src/renderer/session/store')
    const events: AgentEvent[] = [{ type: 'tool_use', id: 'toolu_live', name: 'Agent', input: { subagent_type: 'implementer' }, parentToolUseId: null }]
    if (result) events.push({ type: 'tool_result', toolUseId: 'toolu_live', content: 'done', isError: false, parentToolUseId: null })
    act(() => useSessionLogs.setState(({ logs }) => ({ logs: { ...logs, [sessionId]: { events, first: 0, echo: null, queue: null, settings: null, modelPick: null, context: null } } })))
  }

  it('asks again every POLL_MS while only the live events show a running Subagent, once more when it ends, then stops', async () => {
    // Claude Code has not written the Session's files yet, and no change of them comes: a late
    // file event (FSEvents under load) must not leave the Subagent unopenable.
    filesOf = () => ({ signals: [], files: [], found: false })
    await live(A, false)
    const { hook, store } = await mount([A])
    await vi.waitFor(() => expect(readsOf(A)).toBe(1))
    expect(hook.result.current.get(A)?.[0]?.status).toBe('running')

    await act(async () => vi.advanceTimersByTime(store.POLL_MS))
    await vi.waitFor(() => expect(readsOf(A)).toBe(2))
    await act(async () => vi.advanceTimersByTime(store.POLL_MS))
    await vi.waitFor(() => expect(readsOf(A)).toBe(3))

    // The Subagent ends before the next tick: its transcript may have appeared since the last read,
    // and its file event may be lost, so the files are read once more when it ends.
    await live(A, true)
    await vi.waitFor(() => expect(hook.result.current.get(A)?.[0]?.status).toBe('done'))
    await vi.waitFor(() => expect(readsOf(A)).toBe(4))
    await act(async () => vi.advanceTimersByTime(store.POLL_MS * 3))
    expect(readsOf(A)).toBe(4)
  })

  it('stops asking when the hook unmounts while a Subagent runs', async () => {
    filesOf = () => ({ signals: [], files: [], found: false })
    await live(A, false)
    const { hook, store } = await mount([A])
    await vi.waitFor(() => expect(readsOf(A)).toBe(1))
    await act(async () => vi.advanceTimersByTime(store.POLL_MS))
    await vi.waitFor(() => expect(readsOf(A)).toBe(2))

    await act(async () => hook.unmount())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('asks again only for the Session whose live events show a running Subagent', async () => {
    filesOf = () => ({ signals: [], files: [], found: false })
    await live(A, false)
    const { store } = await mount([A, B])
    await vi.waitFor(() => expect(readsOf(A)).toBe(1))
    await vi.waitFor(() => expect(readsOf(B)).toBe(1))
    for (const reads of [2, 3, 4]) {
      await act(async () => vi.advanceTimersByTime(store.POLL_MS))
      await vi.waitFor(() => expect(readsOf(A)).toBe(reads))
    }
    expect(readsOf(B)).toBe(1)
  })

  it('does not ask again while no Subagent runs', async () => {
    filesOf = () => ({ signals: [], files: [], found: false })
    const { store } = await mount([A])
    await vi.waitFor(() => expect(readsOf(A)).toBe(1))
    await act(async () => vi.advanceTimersByTime(store.POLL_MS * 3))
    expect(readsOf(A)).toBe(1)
  })
})
