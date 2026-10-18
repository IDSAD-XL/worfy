// The window's three readers of `claudeHome.changed` (worfy-windows ticket 57): useClaudeHome, the
// binding signals (src/renderer/binding/store.ts) and the Subagent files
// (src/renderer/claude-home/subagents.ts). Each looks the root up by the string it subscribed
// with: on Windows that is git's `C:/…` from the Project list, so main sends the root back in that
// spelling (src/main/ipc/claude-home.ts, test/contract/claude-home-registry.test.ts) and a change
// under it makes each reader ask main again.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

/** The root as the window has it: git's spelling on Windows. */
const ROOT = 'C:/p'
const S = 'eeeeeeee-0000-4000-8000-000000000005'

const asked: { channel: string; input: unknown }[] = []
const changed: ((payload: unknown) => void)[] = []

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  changed.length = 0
  const answers: Record<string, unknown> = {
    'claudeHome.sessions': { live: [], history: [] },
    'claudeHome.live': { live: [] },
    'claudeHome.subagents': { found: true, signals: [], files: [] },
    'bindings.signals': { sessionId: S, signals: [], subagents: [] },
  }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      return Promise.resolve({ ok: true, value: answers[channel] ?? { closed: true } })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      if (channel === 'claudeHome.changed') changed.push(handler)
      return changed.length
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const calls = (channel: string) => asked.filter((entry) => entry.channel === channel)
const send = async (projectRoot: string, change: { sessions: boolean; transcripts: string[] }) =>
  act(async () => {
    for (const handler of changed) handler({ projectRoot, ...change })
  })

describe('claudeHome.changed with the root in the window\'s spelling', () => {
  it('useClaudeHome reads the live Sessions again', async () => {
    const { useClaudeHome } = await import('../../src/renderer/claude-home/useClaudeHome')
    renderHook(() => useClaudeHome(ROOT))
    await vi.waitFor(() => expect(calls('claudeHome.sessions')).toHaveLength(1))
    expect(calls('claudeHome.sessions')[0]?.input).toEqual({ projectRoot: ROOT })

    // path.resolve's spelling, which main sent before ticket 57: the window does not know the root.
    await send('C:\\p', { sessions: true, transcripts: [] })
    expect(calls('claudeHome.live')).toHaveLength(0)

    await send(ROOT, { sessions: true, transcripts: [] })
    await vi.waitFor(() => expect(calls('claudeHome.live')).toHaveLength(1))
    expect(calls('claudeHome.live')[0]?.input).toEqual({ projectRoot: ROOT })
  })

  it('the binding signals of a Session are read again', async () => {
    const { useSessionSignals } = await import('../../src/renderer/binding/store')
    renderHook(() => useSessionSignals(ROOT, [S]))
    await vi.waitFor(() => expect(calls('bindings.signals')).toHaveLength(1))

    await send('C:\\p', { sessions: false, transcripts: [S] })
    await act(async () => await Promise.resolve())
    expect(calls('bindings.signals')).toHaveLength(1)

    await send(ROOT, { sessions: false, transcripts: [S] })
    await vi.waitFor(() => expect(calls('bindings.signals')).toHaveLength(2))
    expect(calls('bindings.signals')[1]?.input).toEqual({ projectRoot: ROOT, sessionId: S })
  })

  it('the Subagent files of a Session are read again', async () => {
    const { useSubagentTree } = await import('../../src/renderer/claude-home/subagents')
    renderHook(() => useSubagentTree(ROOT, S))
    await vi.waitFor(() => expect(calls('claudeHome.subagents')).toHaveLength(1))

    await send('C:\\p', { sessions: false, transcripts: [S] })
    await act(async () => await Promise.resolve())
    expect(calls('claudeHome.subagents')).toHaveLength(1)

    await send(ROOT, { sessions: false, transcripts: [S] })
    await vi.waitFor(() => expect(calls('claudeHome.subagents')).toHaveLength(2))
    expect(calls('claudeHome.subagents')[1]?.input).toEqual({ projectRoot: ROOT, sessionId: S })
  })
})
