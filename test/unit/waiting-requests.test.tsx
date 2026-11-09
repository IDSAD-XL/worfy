// The open requests of a Session a window did not see go out (worfy-product-session ticket 30): the owner's
// Product Session stood at «needs permission» with no card to answer. A window that opened or reloaded after
// the request has no event to draw its card from; useWaitingRequests (src/renderer/session/open-requests.ts)
// then asks main (`agent.requests`) and takes the open requests into the Session's log, so the card is drawn
// and the Node's badge tells a question from a permission request. When main has none either, `unseen` says
// so and the chat shows a line instead of nothing.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const QUESTION: AgentEvent = {
  type: 'question_request',
  requestId: 'q-1',
  toolUseId: 'toolu_q',
  questions: [{ question: 'Which group first?', header: 'Users', multiSelect: false, options: [{ label: 'Teams', description: '', preview: null }, { label: 'Solo', description: '', preview: null }] }],
}
const PERMISSION: AgentEvent = {
  type: 'permission_request',
  requestId: 'p-1',
  subject: 'Bash',
  toolName: 'Bash',
  toolUseId: 'toolu_p',
  input: { command: 'gh pr view 12' },
  title: null,
  description: null,
  blockedPath: null,
  suggestions: [],
  options: [
    { id: 'allow', label: 'Allow', kind: 'allow' },
    { id: 'deny', label: 'Deny', kind: 'deny' },
  ],
}

/** What main answers `agent.requests` with, and every call the renderer made. */
let open: AgentEvent[]
let asked: string[]

beforeEach(() => {
  vi.resetModules()
  open = []
  asked = []
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => {
      asked.push(channel)
      return Promise.resolve(channel === 'agent.requests' ? { ok: true, value: { requests: open } } : { ok: false, error: `no ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const modules = async () => ({ ...(await import('../../src/renderer/session/open-requests')), ...(await import('../../src/renderer/session/store')) })

describe('useWaitingRequests', () => {
  it('a Session at needs_permission whose request this window never saw: asks main and takes the question into its log', async () => {
    open = [QUESTION]
    const { useWaitingRequests, useSessionLogs } = await modules()
    const { result } = renderHook(() => useWaitingRequests('s', 'needs_permission'))
    await waitFor(() => expect(result.current.questions.map((each) => each.requestId)).toEqual(['q-1']))
    expect(result.current.permissions).toBe(0)
    expect(result.current.unseen).toBe(false)
    expect(asked.filter((each) => each === 'agent.requests')).toHaveLength(1)
    expect(useSessionLogs.getState().logs.s?.events.map((each) => each.type)).toEqual(['question_request'])
  })

  it('asks nothing while the window holds the open request, and nothing for a Session that waits for no answer', async () => {
    const { useWaitingRequests, acceptAgentEvent } = await modules()
    acceptAgentEvent({ sessionId: 's', event: PERMISSION })
    const { result } = renderHook(() => useWaitingRequests('s', 'needs_permission'))
    expect(result.current.permissions).toBe(1)
    renderHook(() => useWaitingRequests('t', 'busy'))
    renderHook(() => useWaitingRequests(null, 'needs_permission'))
    await act(() => Promise.resolve())
    expect(asked).toEqual([])
  })

  it('takes no request twice: one the log holds, opened or resolved, stays as it is', async () => {
    open = [PERMISSION, QUESTION]
    const { loadOpenRequests, acceptAgentEvent, useSessionLogs } = await modules()
    acceptAgentEvent({ sessionId: 's', event: { type: 'question_resolved', requestId: 'q-1', outcome: 'answered', answers: { 'Which group first?': 'Teams' } } })
    await loadOpenRequests('s')
    await loadOpenRequests('s')
    expect(useSessionLogs.getState().logs.s?.events.map((each) => each.type)).toEqual(['question_resolved', 'permission_request'])
  })

  it('a card answered here: the moment between its resolution and the state leaving needs_permission asks main nothing and shows no line', async () => {
    open = [QUESTION]
    const { useWaitingRequests, acceptAgentEvent, ASK_OPEN_REQUESTS_AFTER_MS } = await modules()
    const { result, rerender } = renderHook(({ state }) => useWaitingRequests('s', state), { initialProps: { state: 'needs_permission' } })
    await waitFor(() => expect(result.current.questions).toHaveLength(1))
    open = []
    act(() => acceptAgentEvent({ sessionId: 's', event: { type: 'question_resolved', requestId: 'q-1', outcome: 'answered', answers: { 'Which group first?': 'Teams' } } }))
    expect(result.current.unseen).toBe(false)
    // main's `state` event comes right after the resolution.
    rerender({ state: 'busy' })
    await act(() => new Promise((resolve) => setTimeout(resolve, ASK_OPEN_REQUESTS_AFTER_MS + 150)))
    expect(asked.filter((each) => each === 'agent.requests')).toHaveLength(1)
    expect(result.current.unseen).toBe(false)
  })

  it('a new stretch at needs_permission is not `unseen` before main has answered again', async () => {
    const { useWaitingRequests } = await modules()
    const { result, rerender } = renderHook(({ state }) => useWaitingRequests('s', state), { initialProps: { state: 'needs_permission' } })
    await waitFor(() => expect(result.current.unseen).toBe(true))
    rerender({ state: 'busy' })
    expect(result.current.unseen).toBe(false)
    rerender({ state: 'needs_permission' })
    expect(result.current.unseen).toBe(false)
    await waitFor(() => expect(result.current.unseen).toBe(true))
    expect(asked.filter((each) => each === 'agent.requests')).toHaveLength(2)
  })

  it('main has no open request either: `unseen`, so the view says what the Session waits for', async () => {
    const { useWaitingRequests } = await modules()
    const { result } = renderHook(() => useWaitingRequests('s', 'needs_permission'))
    await waitFor(() => expect(result.current.unseen).toBe(true))
    expect(asked).toEqual(['agent.requests'])
  })
})
