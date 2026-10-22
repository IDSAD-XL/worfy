// The marks of a Live Browser's frame (src/renderer/canvas/nodes/BrowserNode.tsx, worfy-browser
// ticket 05): «Over the Live limit» while main says the Browser is Live beyond the limit, gone once
// main says it is within it again; «Unsaved changes» likewise. Drawn in React Flow in jsdom with the
// real frame and the real store of lives (src/renderer/browser/lives.ts); main (ipc) is faked.
import { act, render, screen, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFollowBrowserLives } from '../../src/renderer/browser/lives'
import BrowserNode from '../../src/renderer/canvas/nodes/BrowserNode'
import { LayoutOpsContext } from '../../src/renderer/canvas/useLayout'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import type { BrowserLife } from '../../src/shared/ipc/browser'
import type { LayoutNode } from '../../src/shared/layout/types'

const PROJECT = 'one-0b0b0b0b'
const PROFILE = 'admin-0b0b0b'

// main: the Project's one profile and the lives it tells; `changed` sends a `browser.lives.changed`.
const main = vi.hoisted(() => ({ lives: [] as BrowserLife[], changed: null as ((change: { projectId: string; lives: BrowserLife[] }) => void) | null }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string) => {
    if (channel === 'browser.profiles.list') return Promise.resolve({ ok: true, value: { profiles: [{ id: PROFILE, name: 'admin', origins: [], autopilot: false } satisfies BrowserProfile] } })
    if (channel === 'browser.control.list') return Promise.resolve({ ok: true, value: { controls: [] } })
    if (channel === 'browser.lives.list') return Promise.resolve({ ok: true, value: { lives: main.lives } })
    return Promise.resolve({ ok: false, error: `${channel} is not faked` })
  },
  subscribe: (channel: string, listener: (change: { projectId: string; lives: BrowserLife[] }) => void) => {
    if (channel === 'browser.lives.changed') main.changed = listener
    return () => undefined
  },
}))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: PROJECT, projects: [{ id: PROJECT, name: 'one', path: '/repo/one', branch: 'main' }] }),
  useReadOnly: () => null,
}))

/** The Browser layer's part here: it follows the lives of the Project. */
function Lives() {
  useFollowBrowserLives(PROJECT)
  return null
}

function drawBrowser(): void {
  const node: LayoutNode = { id: 'browser-1', kind: 'browser', x: 0, y: 0, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { profile: PROFILE } }
  const nodes: Node[] = [{ id: node.id, type: 'browser', position: { x: 0, y: 0 }, data: { node } }]
  render(
    <div style={{ width: 800, height: 600 }}>
      <LayoutOpsContext.Provider value={{ apply: () => Promise.resolve() }}>
        <ReactFlowProvider>
          <Lives />
          <ReactFlow nodes={nodes} edges={[]} nodeTypes={{ browser: BrowserNode }} />
        </ReactFlowProvider>
      </LayoutOpsContext.Provider>
    </div>,
  )
}

const life = (over: Partial<BrowserLife>): BrowserLife => ({ nodeId: 'browser-1', live: true, unsaved: false, overLimit: false, picture: null, here: true, ...over })

describe('the marks on the frame of a Live Browser', () => {
  let hadObserver = false
  beforeEach(() => {
    const globals = globalThis as { ResizeObserver?: unknown }
    hadObserver = 'ResizeObserver' in globals
    globals.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  })
  afterEach(() => {
    if (!hadObserver) delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    main.lives = []
    main.changed = null
  })

  it('«Over the Live limit» while main says so, and gone once the Live Browsers are within the limit again', async () => {
    main.lives = [life({ overLimit: true })]
    drawBrowser()
    expect((await screen.findByTestId('browser-over-limit')).textContent).toBe('Over the Live limit')
    expect(screen.getByTestId('browser-frame').getAttribute('data-life')).toBe('live')
    act(() => main.changed?.({ projectId: PROJECT, lives: [life({ overLimit: false })] }))
    await waitFor(() => expect(screen.queryByTestId('browser-over-limit')).toBeNull())
    expect(screen.queryByTestId('browser-unsaved')).toBeNull()
  })

  it('«Unsaved changes» while its page has a beforeunload handler; no mark on an Asleep frame', async () => {
    main.lives = [life({ unsaved: true })]
    drawBrowser()
    expect((await screen.findByTestId('browser-unsaved')).textContent).toBe('Unsaved changes')
    act(() => main.changed?.({ projectId: PROJECT, lives: [life({ live: false, unsaved: true, overLimit: true })] }))
    await waitFor(() => expect(screen.getByTestId('browser-frame').getAttribute('data-life')).toBe('asleep'))
    expect(screen.queryByTestId('browser-unsaved')).toBeNull()
    expect(screen.queryByTestId('browser-over-limit')).toBeNull()
  })
})
