// The palette's "New browser" (createCanvasNode, carried out by CanvasFind.tsx in the Canvas;
// worfy-browser tickets 14 and 15): the new Browser Node gets the Browser profile of the Project the
// Canvas shows — the only one, or null with several or while the profiles are being read. Drawn in
// React Flow in jsdom with the real profiles store (renderer/browser/profiles.ts): only main (ipc —
// `browser.profiles.list` and the event `browser.profiles.changed`), the Project and the Canvas's
// size are faked, so the whole chain store → newNodeData → the Node's data is the app's own.
import { act, render, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserProfiles } from '../../src/renderer/browser/profiles'
import { LayoutOpsContext } from '../../src/renderer/canvas/useLayout'
import { createCanvasNode } from '../../src/renderer/find/canvas-requests'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import type { LayoutOpInput } from '../../src/shared/layout/types'

type Answer = { ok: true; value: { profiles: BrowserProfile[] } } | { ok: false; error: string }

// main: each `browser.profiles.list` waits in `reads` until the test answers it; `changed` holds the
// handlers of `browser.profiles.changed`, which main sends when a Project's profiles change.
const main = vi.hoisted(() => ({
  reads: [] as { projectId: string; answer: (answer: Answer) => void }[],
  changed: new Set<(change: { projectId: string }) => void>(),
}))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string, input: { projectId: string }) =>
    channel === 'browser.profiles.list'
      ? new Promise<Answer>((resolve) => main.reads.push({ projectId: input.projectId, answer: resolve }))
      : Promise.resolve({ ok: false, error: `${channel} is not faked` }),
  subscribe: (channel: string, handler: (change: { projectId: string }) => void) => {
    if (channel !== 'browser.profiles.changed') return () => undefined
    main.changed.add(handler)
    return () => main.changed.delete(handler)
  },
}))

// Each test shows its own Project, so a list the profiles store kept from an earlier test is never read.
const shown = vi.hoisted(() => ({ projectId: '' }))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: shown.projectId, projects: [{ id: shown.projectId, name: 'one', path: '/repo/one', branch: 'main' }] }),
}))

vi.mock('../../src/renderer/canvas/tidy', () => ({ useTidyUp: () => () => Promise.resolve() }))

const profile = (id: string): BrowserProfile => ({ id, name: id, origins: [], autopilot: false })

/** Answers the oldest read still waiting, which must be of `projectId`, and lets its handler run. */
async function reply(projectId: string, ...ids: string[]): Promise<void> {
  const read = main.reads.shift()
  expect(read?.projectId, 'the read answered').toBe(projectId)
  await act(async () => {
    read?.answer({ ok: true, value: { profiles: ids.map(profile) } })
    await new Promise((resolve) => setImmediate(resolve))
  })
}

/** What keeps the store current in the app: the Browser layer of the Canvas (useBrowserProfiles). */
function KeepProfiles({ projectId }: { projectId: string }) {
  useBrowserProfiles(projectId)
  return null
}

describe('the palette\'s "New browser"', () => {
  let hadObserver = false
  beforeEach(() => {
    const globals = globalThis as { ResizeObserver?: unknown }
    hadObserver = 'ResizeObserver' in globals
    globals.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    // The Canvas has a size: CanvasFind waits for one before it creates the Node in its middle.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) })
  })
  afterEach(() => {
    if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    vi.restoreAllMocks()
    const left = main.reads.length
    main.reads.length = 0
    expect(left, 'reads this test left unanswered').toBe(0)
  })

  /** Draws the Canvas of `shown.projectId`; `newBrowser` runs the palette's command and gives the op it sent. */
  async function drawCanvas() {
    const { default: CanvasFind } = await import('../../src/renderer/find/CanvasFind')
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    render(
      <div style={{ width: 800, height: 600 }}>
        <LayoutOpsContext.Provider value={{ apply }}>
          <ReactFlowProvider>
            <ReactFlow nodes={[]} edges={[]}>
              <KeepProfiles projectId={shown.projectId} />
              <CanvasFind />
            </ReactFlow>
          </ReactFlowProvider>
        </LayoutOpsContext.Provider>
      </div>,
    )
    const newBrowser = async (): Promise<LayoutOpInput> => {
      const before = apply.mock.calls.length
      act(() => createCanvasNode(shown.projectId, 'browser'))
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(before + 1))
      return apply.mock.calls[before]![0]
    }
    return newBrowser
  }

  it('gives the new Browser the only Browser profile of the Project the Canvas shows', async () => {
    shown.projectId = 'p1'
    const newBrowser = await drawCanvas()
    await reply('p1', 'admin-aaaaaa')
    const op = await newBrowser()
    expect(op).toMatchObject({ op: 'create', node: { kind: 'browser', w: 640, h: 440 } })
    expect(op).toHaveProperty('node.data', { profile: 'admin-aaaaaa' })
  })

  it('gives it `profile: null` while the profiles are read: before the first answer, and after main says they changed', async () => {
    shown.projectId = 'p2'
    const newBrowser = await drawCanvas()
    expect(main.reads.map(({ projectId }) => projectId), 'the first read is unanswered').toEqual(['p2'])
    expect(await newBrowser()).toHaveProperty('node.data', { profile: null })
    await reply('p2', 'admin-aaaaaa')
    expect(await newBrowser()).toHaveProperty('node.data', { profile: 'admin-aaaaaa' })
    // A profile was created elsewhere: the one kept from before may not be the only one any more.
    act(() => main.changed.forEach((handler) => handler({ projectId: 'p2' })))
    expect(main.reads.map(({ projectId }) => projectId), 'the read after the change is unanswered').toEqual(['p2'])
    expect(await newBrowser()).toHaveProperty('node.data', { profile: null })
    await reply('p2', 'admin-aaaaaa', 'work-bbbbbb')
  })

  it('gives it `profile: null` when that Project has several', async () => {
    shown.projectId = 'p3'
    const newBrowser = await drawCanvas()
    await reply('p3', 'default', 'admin-aaaaaa')
    expect(await newBrowser()).toHaveProperty('node.data', { profile: null })
  })
})
