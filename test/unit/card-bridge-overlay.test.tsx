// The overlay that runs the Card API bridge in the window (src/renderer/canvas/overlays/CardBridge.tsx,
// ticket 26): which iframes it takes as Card frames, and how a new workflow snapshot reaches a Card
// that subscribed. IPC, the active Project and the workflow read are replaced; the bridge itself and
// the window's `message` events are real.
import { act, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CardBridgeOverlay from '../../src/renderer/canvas/overlays/CardBridge'
import type { WorkflowEntry } from '../../src/renderer/workflow/useWorkflow'
import type { WorkflowModel } from '../../src/shared/workflow/types'

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let entry: { model: unknown; error: string | undefined } = { model: undefined, error: undefined }
  return {
    invoke: vi.fn(),
    workflowRoots: [] as string[],
    workflow: {
      get: () => entry,
      set(next: { model: unknown; error: string | undefined }) {
        entry = next
        for (const listener of listeners) listener()
      },
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
})

vi.mock('../../src/renderer/ipc', () => ({
  invoke: mocks.invoke,
  subscribe: () => () => undefined,
  hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined,
}))
vi.mock('../../src/renderer/projects/useProjects', () => ({
  useProjects: () => ({ projects: [{ id: 'alpha', path: '/repo' }], activeId: 'alpha' }),
  activeProject: () => ({ id: 'alpha', path: '/repo' }),
}))
vi.mock('../../src/renderer/workflow/useWorkflow', () => ({
  useWorkflow: (root: string) => {
    mocks.workflowRoots.push(root)
    return useSyncExternalStore(mocks.workflow.subscribe, mocks.workflow.get) as WorkflowEntry
  },
}))
vi.mock('../../src/renderer/canvas/badges/use-checks', () => ({ useChecks: () => undefined }))

const LABEL = '0a1b2c3d'
const originOf = (cardId: string) => `worfy-card://${cardId}.${LABEL}`

function model(title: string): WorkflowModel {
  return { root: '/repo', epics: [{ epic: 'e', hasSpec: true, hasMap: false, title }], tickets: [], error: null, branchErrors: [] }
}

interface FakeFrame {
  posted: { message: unknown; targetOrigin: string }[]
  postMessage(message: unknown, targetOrigin: string): void
}

/**
 * An iframe inside a Card Node (`data-card-id`, as CardNode.tsx draws it), loading `src`, with a
 * stand-in contentWindow that records what the bridge posts to it.
 */
function cardNode(nodeCardId: string, src: string): FakeFrame {
  const fake: FakeFrame = {
    posted: [],
    postMessage(message, targetOrigin) {
      this.posted.push({ message, targetOrigin })
    },
  }
  const holder = document.createElement('div')
  holder.dataset.cardId = nodeCardId
  const frame = document.createElement('iframe')
  frame.src = src
  Object.defineProperty(frame, 'contentWindow', { value: fake })
  holder.append(frame)
  document.body.append(holder)
  return fake
}

/** A `message` event on the window as if `source` posted it from `origin`. */
function post(source: FakeFrame, origin: string, data: unknown): void {
  const event = new MessageEvent('message', { data, origin })
  Object.defineProperty(event, 'source', { value: source })
  window.dispatchEvent(event)
}

const events = (frame: FakeFrame) => frame.posted.filter(({ message }) => (message as { type?: string }).type === 'worfy.event')

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.workflowRoots.length = 0
  mocks.workflow.set({ model: undefined, error: undefined })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CardBridgeOverlay', () => {
  it('reads the workflow only after a Card asks, then sends each changed snapshot, and only a changed one, to the subscribed Card', async () => {
    const card = cardNode('notes', `${originOf('notes')}/index.html`)
    render(<CardBridgeOverlay />)
    expect(mocks.workflowRoots).toEqual([])

    mocks.workflow.set({ model: model('first'), error: undefined })
    await act(async () => post(card, originOf('notes'), { type: 'worfy.request', requestId: 'c1', op: 'workflow.subscribe' }))
    await waitFor(() => expect(card.posted).toHaveLength(1))
    expect(mocks.workflowRoots).toContain('/repo')
    expect(card.posted[0]).toEqual({
      message: { type: 'worfy.response', requestId: 'c1', ok: true, data: { epics: [{ epic: 'e', title: 'first' }], tickets: [], error: null } },
      targetOrigin: originOf('notes'),
    })

    // A new model with the same content (the checks are asked again every few seconds): no event.
    await act(async () => mocks.workflow.set({ model: model('first'), error: undefined }))
    // A real change: one event with the new snapshot, to the Card's own origin.
    await act(async () => mocks.workflow.set({ model: model('second'), error: undefined }))
    // The same again: still one event.
    await act(async () => mocks.workflow.set({ model: model('second'), error: undefined }))
    // The read fails: the Card hears of that too.
    await act(async () => mocks.workflow.set({ model: undefined, error: 'epic-status failed' }))

    expect(events(card)).toEqual([
      {
        message: { type: 'worfy.event', event: 'workflow', data: { epics: [{ epic: 'e', title: 'second' }], tickets: [], error: null } },
        targetOrigin: originOf('notes'),
      },
      {
        message: { type: 'worfy.event', event: 'workflow', data: { epics: [], tickets: [], error: 'epic-status failed' } },
        targetOrigin: originOf('notes'),
      },
    ])
  })

  it('sends workflow events only to a Card that subscribed, not to one that only read the workflow once', async () => {
    const subscriber = cardNode('notes', `${originOf('notes')}/index.html`)
    const reader = cardNode('board', `${originOf('board')}/index.html`)
    mocks.workflow.set({ model: model('first'), error: undefined })
    render(<CardBridgeOverlay />)

    await act(async () => post(subscriber, originOf('notes'), { type: 'worfy.request', requestId: 'c1', op: 'workflow.subscribe' }))
    await act(async () => post(reader, originOf('board'), { type: 'worfy.request', requestId: 'c1', op: 'workflow.get' }))
    await waitFor(() => expect(reader.posted).toHaveLength(1))
    await act(async () => mocks.workflow.set({ model: model('second'), error: undefined }))

    expect(events(subscriber)).toHaveLength(1)
    expect(events(reader)).toEqual([])
  })

  it('takes an iframe as a Card frame only when its address names the Card of its own Node', async () => {
    mocks.invoke.mockResolvedValue({ ok: true, value: { value: { n: 1 } } })
    // The Node of Card "notes" holds a frame whose address is Card "other".
    const stray = cardNode('notes', `${originOf('other')}/index.html`)
    const card = cardNode('board', `${originOf('board')}/index.html`)
    render(<CardBridgeOverlay />)

    post(stray, originOf('other'), { type: 'worfy.request', requestId: 'c1', op: 'data.get' })
    post(card, originOf('board'), { type: 'worfy.request', requestId: 'c1', op: 'data.get' })
    // The bridge calls main synchronously when it takes a request: only the matching frame's did.
    expect(mocks.invoke.mock.calls).toEqual([['cardApi.dataGet', { projectId: 'alpha', cardId: 'board' }]])
    await waitFor(() => expect(card.posted).toHaveLength(1))
    expect(card.posted[0]?.message).toEqual({ type: 'worfy.response', requestId: 'c1', ok: true, data: { n: 1 } })
    expect(stray.posted).toEqual([])
  })
})
