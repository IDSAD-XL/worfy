// The Browser layer as a component (src/renderer/canvas/overlays/BrowserLayer.tsx, worfy-browser
// ticket 15): React Flow's store read through the layer's selector and JSON.parse, the page placed by
// the profile rule, and the profile written into the Node. Drawn in React Flow in jsdom with the real
// Browser frame (BrowserNode) and the real profiles store; only main (ipc) and the Project are faked.
// A Browser saved before profiles existed has a page address and no `profile` key: the layer must keep
// the key absent, or the rule that keeps such a Browser on `default` never applies to it.
import { render, screen, waitFor } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserProfilesNow } from '../../src/renderer/browser/profiles'
import BrowserNode from '../../src/renderer/canvas/nodes/BrowserNode'
import BrowserLayer from '../../src/renderer/canvas/overlays/BrowserLayer'
import { LayoutOpsContext } from '../../src/renderer/canvas/useLayout'
import type { BrowserProfile } from '../../src/shared/browser/profiles'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'

// main: `browser.profiles.list` answers the profiles each Project has here, and `browser.lives.list`
// that the Browser b0 is Live (worfy-browser ticket 05: the layer draws a page only for a Live
// Browser); nothing else is asked.
const main = vi.hoisted(() => ({ profiles: {} as Record<string, string[]> }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: (channel: string, input: { projectId: string }) => {
    if (channel === 'browser.lives.list') return Promise.resolve({ ok: true, value: { projectId: input.projectId, lives: [{ nodeId: 'b0', live: true, unsaved: false, overLimit: false, picture: null, here: true }] } })
    if (channel !== 'browser.profiles.list') return Promise.resolve({ ok: false, error: `${channel} is not faked` })
    const profiles = (main.profiles[input.projectId] ?? []).map((id): BrowserProfile => ({ id, name: id, origins: [], autopilot: false }))
    return Promise.resolve({ ok: true, value: { profiles } })
  },
  subscribe: () => () => undefined,
}))

// Each test shows its own Project, so a list the profiles store kept from an earlier test is never read.
const shown = vi.hoisted(() => ({ projectId: '' }))
vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: shown.projectId, projects: [{ id: shown.projectId, name: 'one', path: '/repo/one', branch: 'main' }] }),
  useReadOnly: () => null,
}))

const page = 'http://127.0.0.1:3000/page.html'

/** An old Browser as the Canvas holds it: a page address and no `profile` key in its Layout Node. */
function oldBrowser(id: string): Node {
  const node: LayoutNode = { id, kind: 'browser', x: 0, y: 0, w: 640, h: 440, hidden: false, locked: false, pinned: false, tags: [], data: { url: page } }
  return { id, type: 'browser', position: { x: 0, y: 0 }, data: { node } }
}

function drawCanvas(nodes: Node[]) {
  const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
  render(
    <div style={{ width: 800, height: 600 }}>
      <LayoutOpsContext.Provider value={{ apply }}>
        <ReactFlowProvider>
          <ReactFlow nodes={nodes} edges={[]} nodeTypes={{ browser: BrowserNode }}>
            <BrowserLayer />
          </ReactFlow>
        </ReactFlowProvider>
      </LayoutOpsContext.Provider>
    </div>,
  )
  return apply
}

describe('the Browser layer with an old Browser (a page address, no `profile` key)', () => {
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
    main.profiles = {}
  })

  it('asks for a profile when `default` is gone and two others are left: no <webview>, nothing written into the Node', async () => {
    shown.projectId = 'alpha-0a1b2c3d'
    main.profiles = { [shown.projectId]: ['work-bbbbbb', 'admin-aaaaaa'] }
    const apply = drawCanvas([oldBrowser('b0')])
    // Main's answer is in the profiles store, which the layer and the frame both read. React draws a
    // store change in one commit for both, before waitFor looks again, and the layer writes a profile
    // from that commit's effect: from here on the test sees what the layer did with the list.
    await waitFor(() => expect(browserProfilesNow(shown.projectId)?.map((profile) => profile.id)).toEqual(['work-bbbbbb', 'admin-aaaaaa']))
    // React Flow keeps a Node it has not measured hidden (jsdom measures nothing): found by test id.
    expect(screen.getByTestId('browser-choose-profile-button').textContent).toBe('Choose a profile')
    expect(screen.getByTestId('browser-choose-profile').textContent).toContain('The Browser profile of this Browser was deleted.')
    expect(document.querySelector('webview')).toBeNull()
    expect(screen.queryByTestId('browser-layer')).toBeNull()
    expect(apply).not.toHaveBeenCalled()
  })

  it('opens it under `default` while `default` exists, and writes `default` into the Node', async () => {
    shown.projectId = 'beta-1a2b3c4d'
    main.profiles = { [shown.projectId]: ['default', 'admin-aaaaaa'] }
    const apply = drawCanvas([oldBrowser('b0')])
    await waitFor(() => expect(document.querySelector('webview[data-browser-id="b0"]')).not.toBeNull())
    const view = document.querySelector('webview[data-browser-id="b0"]')
    expect(view?.getAttribute('partition')).toBe('persist:worfy-browser-1a2b3c4d-default')
    expect(view?.getAttribute('src')).toBe(page)
    expect(screen.getByTestId('browser-frame').getAttribute('data-profile')).toBe('default')
    expect(screen.queryByTestId('browser-choose-profile')).toBeNull()
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ op: 'patchData', id: 'b0', data: { profile: 'default' } }))
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
