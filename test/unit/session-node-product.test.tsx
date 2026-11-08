// A Product Session's Node on the Canvas (src/renderer/canvas/nodes/SessionNode.tsx,
// worfy-product-session ticket 06): still a Session Node, told apart by the label «Product Session»
// where a plain Session's Node says «Session». The kind comes from the Node's data, and from main's
// view while the Session runs.
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'

// Imported once while the file is collected (see session-node-drop.test.tsx): the first import of
// the Node transforms every renderer module it reaches, too slow for one test on a loaded machine.
await import('../../src/renderer/canvas/nodes/SessionNode')

const ROOT = '/Users/test/projects/demo'
const PROJECT = { id: 'demo-0000000a', name: 'demo', path: ROOT, branch: 'main' }
const NODE = 'session-node-1'
const SAVED = 'dddddddd-0000-4000-8000-000000000004'

/** main's views of the Node's Session: none means it is not running. */
let views: SessionNodeView[]

const view = (over: Partial<SessionNodeView> = {}): SessionNodeView => ({
  projectId: PROJECT.id,
  nodeId: NODE,
  vendor: 'claude',
  sessionId: 'live-1',
  sdkSessionId: null,
  state: 'idle',
  error: null,
  cwd: ROOT,
  model: null,
  version: 1,
  ...over,
})

beforeEach(() => {
  vi.resetModules()
  views = []
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string) => {
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
      return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Renders a Session Node with `data` and answers it once its status chip says `status`. */
async function mount(data: Record<string, unknown>, status: string): Promise<HTMLElement> {
  const { default: SessionNode } = await import('../../src/renderer/canvas/nodes/SessionNode')
  const props = { id: NODE, data: { node: { id: NODE, kind: 'session', data } }, selected: false } as unknown as CanvasNodeProps
  render(
    <ReactFlowProvider>
      <SessionNode {...props} />
    </ReactFlowProvider>,
  )
  await vi.waitFor(() => expect(screen.getByTestId('session-node').getAttribute('data-status')).toBe(status))
  return screen.getByTestId('session-node')
}

describe('the label of a Product Session on the Canvas', () => {
  it('a new Node of kind product says «Product Session», in its label and in its name', async () => {
    const node = await mount({ origin: 'worfy', kind: 'product' }, 'new')
    expect(screen.getByTestId('session-node-kind').textContent).toBe('Product Session')
    expect(node.getAttribute('aria-label')).toBe('New Product Session')
    expect(node.getAttribute('data-session-kind')).toBe('product')
    expect(screen.getByTestId('session-node-title').textContent).toBe('New Product Session')
  })

  it('a finished one keeps the label, and its name says Product Session, not Session', async () => {
    const node = await mount({ origin: 'worfy', kind: 'product', sessionId: SAVED }, 'finished')
    expect(screen.getByTestId('session-node-kind').textContent).toBe('Product Session')
    expect(node.getAttribute('aria-label')).toBe(`Product Session ${SAVED.slice(0, 8)}`)
  })

  it('a running one takes the kind from main’s view as well', async () => {
    views = [view({ kind: 'product' })]
    await mount({ origin: 'worfy' }, 'idle')
    expect(screen.getByTestId('session-node-kind').textContent).toBe('Product Session')
  })

  it('a plain Session has no such label and is named a Session, as before', async () => {
    const node = await mount({ origin: 'worfy', sessionId: SAVED }, 'finished')
    expect(screen.queryByTestId('session-node-kind')).toBeNull()
    expect(node.getAttribute('data-session-kind')).toBeNull()
    expect(node.getAttribute('aria-label')).toBe(`Session ${SAVED.slice(0, 8)}`)
    expect(screen.getByTestId('session-node-title').textContent).toBe(`Session ${SAVED.slice(0, 8)}`)
  })

  it('a kind this build does not know is no Product Session', async () => {
    await mount({ origin: 'worfy', kind: 'later-kind', sessionId: SAVED }, 'finished')
    expect(screen.queryByTestId('session-node-kind')).toBeNull()
  })
})
