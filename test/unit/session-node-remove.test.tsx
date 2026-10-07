// The Hide and Remove hints of a read-only Session Node (worfy-week ticket 12,
// src/renderer/canvas/nodes/SessionNode.tsx). Hiding or removing the Node leaves the Session
// alone: while it runs in a terminal or in Claude desktop, it goes on; once it has finished, what
// stays is its transcript. The hint says whichever is true now.
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LiveSession } from '../../src/shared/ipc/claude-home'

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
async function mount(status: string): Promise<{ hide: HTMLElement; remove: HTMLElement }> {
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
  return { hide: screen.getByRole('button', { name: 'Hide' }), remove: screen.getByRole('button', { name: 'Remove' }) }
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
