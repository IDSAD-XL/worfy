// The Hide and Remove hints of a read-only Session Node (worfy-week ticket 12,
// src/renderer/canvas/nodes/SessionNode.tsx). Hiding or removing the Node leaves the Session
// alone: while it runs in a terminal or in Claude desktop, it goes on; once it has finished, what
// stays is its transcript. The hint says whichever is true now. Its Archive (worfy-product-session
// ticket 37) is active once the Session has finished, and inactive, saying why, while it runs.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import { installHeaderLayout, menuItems, type HeaderLayout } from './session-header-layout'

const ROOT = '/Users/test/projects/demo'
const PROJECT = { id: 'demo-0000000a', name: 'demo', path: ROOT, branch: 'main' }
const SESSION = 'dddddddd-0000-4000-8000-000000000004'

let live: LiveSession[]

beforeEach(() => {
  vi.resetModules()
  live = []
  const bridge = {
    invoke: (channel: string) => {
      const value: unknown =
        channel === 'projects.list'
          ? { projects: [PROJECT], activeId: PROJECT.id, revision: 1 }
          : channel === 'claudeHome.sessions'
            ? { live, history: [] }
            : channel === 'claudeHome.live'
              ? { live }
              : undefined
      return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Renders the read-only Node of SESSION and waits until its status chip says `status`. */
async function mount(status: string): Promise<{ hide: HTMLElement; remove: HTMLElement; archive: HTMLButtonElement }> {
  const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
  const data = { node: { id: `session-${SESSION}`, kind: 'session', data: { origin: 'external', sessionId: SESSION, source: 'terminal', cwd: ROOT } } }
  const props = { id: `session-${SESSION}`, data, selected: false } as unknown as CanvasNodeProps
  render(
    <ReactFlowProvider>
      <SessionNode {...props} />
    </ReactFlowProvider>,
  )
  const node = await screen.findByTestId('session-node')
  await vi.waitFor(() => expect(node.getAttribute('data-status')).toBe(status))
  return { hide: screen.getByRole('button', { name: 'Hide' }), remove: screen.getByRole('button', { name: 'Remove' }), archive: screen.getByTestId<HTMLButtonElement>('session-node-archive') }
}

describe('read-only Session Node: Hide and Remove hints', () => {
  it('a finished Session: the transcript stays', async () => {
    const { hide, remove } = await mount('finished')
    expect(hide.getAttribute('title')).toBe('Hide the Node; the transcript stays')
    expect(remove.getAttribute('title')).toBe('Remove the Node; the transcript stays')
  })

  it('a Session that still runs: it goes on', async () => {
    live = [{ pid: 100, sessionId: SESSION, cwd: ROOT, status: 'idle', entrypoint: 'cli' }]
    const { hide, remove } = await mount('idle')
    expect(hide.getAttribute('title')).toBe('Hide the Node; the Session goes on')
    expect(remove.getAttribute('title')).toBe('Remove the Node; the Session goes on')
  })
})

describe('read-only Session Node: Archive', () => {
  it('a finished Session: active, with what it does', async () => {
    const { archive } = await mount('finished')
    expect(archive.disabled).toBe(false)
    expect(archive.getAttribute('title')).toMatch(/nothing is deleted/)
  })

  it('a Session that still runs in the registry: inactive, saying why', async () => {
    live = [{ pid: 100, sessionId: SESSION, cwd: ROOT, status: 'idle', entrypoint: 'cli' }]
    const { archive } = await mount('idle')
    expect(archive.disabled).toBe(true)
    expect(archive.getAttribute('title')).toBe('The Session still runs; archive its Node once it ends')
  })
})

describe('read-only Session Node: the header buttons in the «⋯» menu (worfy-polish ticket 153)', () => {
  let layout: HeaderLayout | undefined
  afterEach(() => {
    cleanup()
    layout?.restore()
    layout = undefined
  })

  it('a 240 px header puts Keep, Hide and Remove in the menu, with the same hints', async () => {
    layout = installHeaderLayout(240)
    const { default: SessionNode, TITLE_MIN } = await import('../../src/renderer/canvas/nodes/SessionNode')
    const data = { node: { id: `session-${SESSION}`, kind: 'session', data: { origin: 'external', sessionId: SESSION, source: 'terminal', cwd: ROOT } } }
    render(
      <ReactFlowProvider>
        <SessionNode {...({ id: `session-${SESSION}`, data, selected: false } as unknown as CanvasNodeProps)} />
      </ReactFlowProvider>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('session-node').getAttribute('data-status')).toBe('finished'))
    expect(within(screen.getByTestId('session-node-header')).getAllByRole('button').map((button) => button.textContent)).toEqual(['⋯'])
    expect(layout.titleWidth()).toBeGreaterThanOrEqual(TITLE_MIN)
    fireEvent.click(screen.getByTestId('session-node-more'))
    const items = menuItems(screen.getByRole('menu', { name: 'Session actions' }))
    expect(items.map((item) => [item.textContent, item.getAttribute('title')])).toEqual([
      ['Keep', 'Keep this Session on the Canvas: the archive leaves it'],
      ['Hide', 'Hide the Node; the transcript stays'],
      ['Remove', 'Remove the Node; the transcript stays'],
    ])
  })
})
