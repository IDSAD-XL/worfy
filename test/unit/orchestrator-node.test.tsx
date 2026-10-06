// The Orchestrator Node (src/renderer/canvas/nodes/OrchestratorNode.tsx) against main's view of
// the Orchestrator: asked for once with `orchestrator.view`, then followed on
// `orchestrator.changed`. The answer and a later event can arrive in either order; the bridge is
// a fake whose answer the test releases by hand.
import { act, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { ORCHESTRATOR_HEIGHT, ORCHESTRATOR_KIND, ORCHESTRATOR_WIDTH, type OrchestratorView } from '../../src/shared/ipc/orchestrator'

const BLOCK_OLD = ['— Этап: волна 4', '— Сейчас: старое', '— Дальше: старое', '— Жду: ничего'].join('\n')
const BLOCK_NEW = ['— Этап: волна 5', '— Сейчас: новое', '— Дальше: PR', '— Жду: ничего'].join('\n')

const view = (version: number, overrides: Partial<OrchestratorView> = {}): OrchestratorView => ({
  projectId: 'alpha-0000000a',
  nodeId: 'orch',
  sessionId: 'pending-1',
  state: 'idle',
  error: null,
  model: 'claude-opus-5-5',
  costUsd: 0.0125,
  statusBlock: BLOCK_OLD,
  version,
  ...overrides,
})

let answer: (value: { view: OrchestratorView | null }) => void
let changed: ((payload: unknown) => void) | undefined
const asked: { channel: string; input: unknown }[] = []

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  changed = undefined
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      return new Promise((resolve) => (answer = (value) => resolve({ ok: true, value })))
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      if (channel === 'orchestrator.changed') changed = handler
      return 1
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function mount(nodeId = 'orch') {
  const module = await import('../../src/renderer/canvas/nodes/OrchestratorNode')
  const props = { id: nodeId, data: { node: { data: {} } }, selected: false } as unknown as CanvasNodeProps
  render(
    <ReactFlowProvider>
      <module.default {...props} />
    </ReactFlowProvider>,
  )
  return module
}

describe('OrchestratorNode', () => {
  it('declares the kind and size main creates its Node with', async () => {
    const module = await mount()
    expect({ kind: module.kind, w: module.defaultWidth, h: module.defaultHeight }).toEqual({ kind: ORCHESTRATOR_KIND, w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT })
  })

  it('subscribes before it asks, and shows the answer', async () => {
    await mount()
    expect(changed).toBeTypeOf('function')
    expect(asked).toEqual([{ channel: 'orchestrator.view', input: { nodeId: 'orch' } }])
    expect(screen.getByTestId('orchestrator-cost').textContent).toBe('—')
    expect(screen.getByTestId('orchestrator-status-block-empty').textContent).toBe('No status block yet')
    await act(async () => answer({ view: view(1) }))
    expect(screen.getByTestId('orchestrator-state').textContent).toBe('idle')
    expect(screen.getByTestId('orchestrator-model').textContent).toBe('claude-opus-5-5')
    expect(screen.getByTestId('orchestrator-cost').textContent).toBe('$0.0125')
    expect(screen.getByTestId('orchestrator-status-block').textContent).toBe(BLOCK_OLD)
  })

  it('keeps a newer change when the older answer arrives after it', async () => {
    await mount()
    act(() => changed?.(view(5, { state: 'busy', statusBlock: BLOCK_NEW })))
    expect(screen.getByTestId('orchestrator-status-block').textContent).toBe(BLOCK_NEW)
    await act(async () => answer({ view: view(3) }))
    expect(screen.getByTestId('orchestrator-status-block').textContent).toBe(BLOCK_NEW)
    expect(screen.getByTestId('orchestrator-state').textContent).toBe('busy')
    // A later change still replaces it.
    act(() => changed?.(view(6, { state: 'error', error: 'Claude Code exited' })))
    expect(screen.getByTestId('orchestrator-state').textContent).toBe('error')
    expect(screen.getByTestId('orchestrator-state').getAttribute('title')).toBe('Claude Code exited')
  })

  it('shows each line of the block on one row, cut with an ellipsis, with the whole line in its title', async () => {
    const long = ['— Этап: волна 8 · ' + 'а'.repeat(80), '— Сейчас: ' + 'б'.repeat(80), '— Дальше: ' + 'в'.repeat(80), '— Жду: ' + 'г'.repeat(80)]
    await mount()
    await act(async () => answer({ view: view(1, { statusBlock: long.join('\n') }) }))
    const block = screen.getByTestId('orchestrator-status-block')
    // The text stays verbatim: copying the block gives the four lines as written.
    expect(block.textContent).toBe(long.join('\n'))
    const rows = screen.getAllByTestId('orchestrator-status-line')
    expect(rows.map((row) => row.textContent)).toEqual(long)
    expect(rows.map((row) => row.getAttribute('title'))).toEqual(long)
    for (const row of rows) {
      expect(row.style.whiteSpace).toBe('pre')
      expect(row.style.overflow).toBe('hidden')
      expect(row.style.textOverflow).toBe('ellipsis')
    }
  })

  it("ignores another Node's views", async () => {
    await mount()
    act(() => changed?.(view(2, { nodeId: 'other', statusBlock: BLOCK_NEW })))
    expect(screen.getByTestId('orchestrator-status-block-empty')).toBeDefined()
    await act(async () => answer({ view: null }))
    expect(screen.getByTestId('orchestrator-state').textContent).toBe('starting')
  })
})
