// How the window keeps a transcript read from its end (worfy-ui ticket 21,
// src/renderer/claude-home/useClaudeHome.ts): the KEEP_EVENTS cap and «Load earlier», a stale
// «Load earlier» answer after the file was opened again, the control in the transcript
// (src/renderer/session/Transcript.tsx), and the last answer of a resumed Session Node, which reads
// only the window at the end of the file. A fake bridge answers; no main process.
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
    answers.push(() => ok({ reset: true }))
    answers.push((request) => {
      expect(request.back).toStrictEqual({ bytes: WINDOW })
      return ok({ ...lines(0, 3), earlier: 0, cursor: { offset: 300, fileId: 'dev:other' } })
    })
    await act(async () => {
      await module.loadEarlierTranscript(ROOT, S)
    })
    await vi.waitFor(() => expect(texts(hook.result.current.events)).toEqual(['answer 0', 'answer 1', 'answer 2']))
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
