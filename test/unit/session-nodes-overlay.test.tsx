// The Session Nodes overlay (src/renderer/canvas/overlays/SessionNodes.tsx) against a fake main:
// how it uses the plan of src/renderer/claude-home/session-nodes.ts. The race it must survive:
// at SDK start the registry file of worfy's own Session (the Orchestrator) appears before the
// Orchestrator Node saves `data.sessionId`, so only `agent.list` says the Session is worfy's.
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { applyNodeChanges, ReactFlowProvider, useStoreApi, type Node, type NodeChange } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import { layoutNodeSchema, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../src/shared/layout/types'

const ROOT = '/Users/test/projects/demo'
const PROJECT = 'demo-0000000a'
const WORFY = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002'

const live = (sessionId: string): LiveSession => ({ pid: 100, sessionId, cwd: ROOT, status: 'idle', entrypoint: 'cli' })
const node = (fields: Partial<LayoutNode> & { id: string; kind: string }): LayoutNode => layoutNodeSchema.parse({ x: 0, y: 0, w: 300, h: 120, ...fields })
const orchestrator = (sessionId: string | null) => node({ id: 'orch', kind: 'orchestrator', w: 360, h: 200, data: { sessionId } })
const external = (sessionId: string) =>
  node({ id: `session:${sessionId}`, kind: 'session', data: { sessionId, origin: 'external', source: 'terminal', cwd: ROOT } })

let layoutNodes: LayoutNode[]
let liveSessions: LiveSession[]
let running: string[]
let agentListAnswer: { ok: boolean; value?: unknown; error?: string }
const asked: string[] = []
const applied: LayoutOpInput[] = []

beforeEach(() => {
  vi.resetModules()
  asked.length = 0
  applied.length = 0
  running = []
  agentListAnswer = { ok: true }
  const bridge = {
    invoke: (channel: string) => {
      asked.push(channel)
      const ok = (value: unknown) => Promise.resolve({ ok: true, value })
      switch (channel) {
        case 'projects.list':
          return ok({ projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 })
        case 'layout.get':
          return ok({ projectId: PROJECT, revision: 1, layout: { nodes: layoutNodes, viewport: { x: 0, y: 0, zoom: 1 } } } satisfies LayoutState)
        case 'claudeHome.sessions':
          return ok({ live: liveSessions, history: [] })
        case 'claudeHome.live':
          return ok({ live: liveSessions })
        case 'agent.list':
          return Promise.resolve(agentListAnswer.ok ? { ok: true, value: running.map((sessionId) => ({ sessionId, cwd: ROOT, state: 'idle' })) } : agentListAnswer)
        default:
          return ok({ closed: true })
      }
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

type FlowStore = ReturnType<typeof useStoreApi>
let flowStore: FlowStore | undefined

function GrabStore() {
  const store = useStoreApi()
  useEffect(() => {
    flowStore = store
  }, [store])
  return null
}

async function mount(): Promise<void> {
  const overlay = await import('../../src/renderer/canvas/overlays/SessionNodes')
  const { LayoutOpsContext } = await import('../../src/renderer/canvas/useLayout')
  const ops = {
    apply: (op: LayoutOpInput) => {
      applied.push(op)
      return Promise.resolve()
    },
  }
  render(
    <ReactFlowProvider>
      <GrabStore />
      <LayoutOpsContext.Provider value={ops}>
        <overlay.default />
      </LayoutOpsContext.Provider>
    </ReactFlowProvider>,
  )
}

/** Lets every answer of the fake main and every operation that follows it run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) await act(async () => await Promise.resolve())
}

const created = () => applied.flatMap((op) => (op.op === 'create' ? [String(op.node.data?.sessionId)] : []))
const removed = () => applied.flatMap((op) => (op.op === 'remove' ? [op.id] : []))

describe('SessionNodes overlay', () => {
  it("gives no external Node to worfy's own Session whose Node does not name it yet: agent.list says it is worfy's", async () => {
    layoutNodes = [orchestrator(null)]
    liveSessions = [live(WORFY), live(OTHER)]
    running = [WORFY]
    await mount()
    await vi.waitFor(() => expect(created()).toEqual([OTHER]))
    await settle()
    expect(asked).toContain('agent.list')
    expect(created()).toEqual([OTHER])
    expect(removed()).toEqual([])
  })

  it('still creates Nodes for the other Sessions when agent.list fails', async () => {
    layoutNodes = [orchestrator(null)]
    liveSessions = [live(OTHER)]
    agentListAnswer = { ok: false, error: 'main is gone' }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mount()
    await vi.waitFor(() => expect(created()).toEqual([OTHER]))
    expect(error).toHaveBeenCalledWith('agent.list failed:', 'main is gone')
    error.mockRestore()
  })

  it('removes the external Node made before worfy named the Session, and creates no new one', async () => {
    layoutNodes = [orchestrator(WORFY), external(WORFY)]
    liveSessions = [live(WORFY)]
    await mount()
    await vi.waitFor(() => expect(removed()).toEqual([`session:${WORFY}`]))
    await settle()
    expect(created()).toEqual([])
  })

  it('does not ask agent.list when there is nothing to create or remove', async () => {
    layoutNodes = [orchestrator(WORFY), external(OTHER)]
    liveSessions = [live(WORFY), live(OTHER)]
    await mount()
    await vi.waitFor(() => expect(asked).toContain('claudeHome.sessions'))
    await settle()
    expect(asked).not.toContain('agent.list')
    expect(applied).toEqual([])
  })

  describe('a focus request from the sidebar', () => {
    const ID = `session:${OTHER}`
    const flowNode = (hidden: boolean, extra: Partial<Node> = {}): Node => ({ id: ID, position: { x: 0, y: 0 }, width: 300, height: 120, hidden, data: {}, ...extra })
    const isSelected = (id: string) => (flowStore as FlowStore).getState().nodes.find((each) => each.id === id)?.selected ?? false
    const frames = async (count: number) => {
      for (let n = 0; n < count; n += 1) await act(async () => await new Promise((done) => requestAnimationFrame(() => done(undefined))))
    }

    /**
     * Selection changes React Flow was asked for, with whether the Node was hidden at that moment.
     * The changes are applied to the Nodes a moment later, as the Canvas does with its React state.
     */
    async function mountForFocus(): Promise<{ selected: { id: string; hidden: boolean | undefined }[]; focus: () => void }> {
      layoutNodes = []
      liveSessions = []
      await mount()
      const store = flowStore as FlowStore
      const selected: { id: string; hidden: boolean | undefined }[] = []
      act(() =>
        store.setState({
          width: 800,
          height: 600,
          onNodesChange: (changes: NodeChange[]) => {
            for (const change of changes) {
              if (change.type === 'select' && change.selected) selected.push({ id: change.id, hidden: store.getState().nodeLookup.get(change.id)?.hidden })
            }
            queueMicrotask(() => store.getState().setNodes(applyNodeChanges(changes, store.getState().nodes)))
          },
        }),
      )
      const { focusSessionNode } = await import('../../src/renderer/claude-home/focus')
      return { selected, focus: () => act(() => focusSessionNode(PROJECT, ID)) }
    }

    it('waits for a Node that is not in React Flow yet, then selects it', async () => {
      const { selected, focus } = await mountForFocus()
      focus()
      await frames(3)
      expect(selected).toEqual([])
      act(() => (flowStore as FlowStore).getState().setNodes([flowNode(false)]))
      await vi.waitFor(() => expect(selected).toEqual([{ id: ID, hidden: false }]))
    })

    it('does not select a Node while it is still hidden: it waits until the Node is shown', async () => {
      const { selected, focus } = await mountForFocus()
      act(() => (flowStore as FlowStore).getState().setNodes([flowNode(true)]))
      focus()
      await frames(3)
      expect(selected).toEqual([])
      act(() => (flowStore as FlowStore).getState().setNodes([flowNode(false)]))
      await vi.waitFor(() => expect(selected).toEqual([{ id: ID, hidden: false }]))
    })

    it('keeps a Node selected that was selected before it was hidden, and deselects the others', async () => {
      const { focus } = await mountForFocus()
      const orch: Node = { id: 'orch', position: { x: 400, y: 0 }, width: 360, height: 200, data: {}, selected: true }
      // The click on its Hide button selected the Node before it was hidden.
      act(() => (flowStore as FlowStore).getState().setNodes([flowNode(true, { selected: true }), orch]))
      focus()
      await frames(2)
      act(() => (flowStore as FlowStore).getState().setNodes([flowNode(false, { selected: true }), orch]))
      await frames(3)
      expect({ session: isSelected(ID), orch: isSelected('orch') }).toEqual({ session: true, orch: false })
    })
  })
})
