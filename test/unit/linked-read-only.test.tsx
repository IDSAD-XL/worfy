// The screen of a Linked machine that shares its Projects with this Machine read-only (worfy-link
// ticket 25, ADR-0066): every action that would call a `write` channel there is inactive, with the
// tooltip "<Machine> gives this Machine read-only access", and the code that sends stops before the
// call; with Full access everything is as before.
//
// The window is on Linked machine M (`?machine=` in its address). The read-only level comes the way
// it comes in the app: `linked.state` from this Machine's main, the Machine's name from `link.state`.
// Nothing here replaces useReadOnly(): a hook that always answered "full access" turns these red.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasFlowNode, CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LinkState } from '../../src/shared/ipc/link'
import type { LinkedState } from '../../src/shared/ipc/linked'
import type { LayoutNode } from '../../src/shared/layout/types'

const THIS = '11111111-1111-4111-8111-111111111111'
const M = '22222222-2222-4222-8222-222222222222'
const PROJECT = 'shop-00000001'
const HINT = 'Mini gives this Machine read-only access'

// React Flow's NodeResizer draws its handles from the store of a real Node; a stand-in shows whether
// NodeResizeClamp put one there at all.
const resizer = vi.hoisted(() => ({ drawn: 0 }))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    NodeResizer: () => {
      resizer.drawn += 1
      return null
    },
  }
})

// The Terminal Node's own component opens the shell (`terminal.open`) when it mounts; a stand-in
// with the same kind and Canvas menu item counts the mounts instead, so a test sees whether a
// screen mounted it at all. The registry (nodes/index.ts) finds it as it finds the real one.
const terminal = vi.hoisted(() => ({ mounted: 0 }))
vi.mock('../../src/renderer/canvas/nodes/TerminalNode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/canvas/nodes/TerminalNode')>()
  return {
    ...actual,
    // The registry reads it whether the file declares it or not; a mock throws on an export it lacks.
    minimapColor: (actual as { minimapColor?: string }).minimapColor,
    kindColour: (actual as { kindColour?: string }).kindColour,
    default: () => {
      terminal.mounted += 1
      return <div data-testid="terminal-node" />
    },
  }
})

// The Canvas holds a Node that asks to be dragged on its own (a Subagent's) through
// lockedForReadOnly; the Nodes of a Layout never ask, so the test sees the level the Canvas hands it.
const locked = vi.hoisted(() => ({ levels: [] as (string | null)[] }))
vi.mock('../../src/renderer/canvas/read-only-nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/canvas/read-only-nodes')>()
  return {
    lockedForReadOnly: (...args: Parameters<typeof actual.lockedForReadOnly>) => {
      locked.levels.push(args[1])
      return actual.lockedForReadOnly(...args)
    },
  }
})

const linkState: LinkState = {
  revision: 1,
  machine: { id: THIS, name: 'Studio' },
  problem: null,
  listening: true,
  addresses: [],
  bonjour: false,
  linking: { open: false, code: null, expiresAt: null, linked: null, failure: null },
  linked: [{ id: M, name: 'Mini', state: 'online', certificateChanged: false, access: 'all' }],
  discovered: [],
  projectsAccess: false,
  keepAwake: true,
}

const linkedState = (readOnly: boolean, revision = 1): LinkedState => ({ revision, machines: [{ id: M, online: true, sharing: 'yes', readOnly, epoch: 1 }] })

const LIST = { projects: [{ id: PROJECT, name: 'shop', path: '/repos/shop', branch: 'main' }], activeId: PROJECT, revision: 1 }

interface Fake {
  /** Every channel called, by name: this Machine's own, and those sent on to M (`linked.invoke`). */
  calls: string[]
  /** The channels sent on to M. */
  sent: string[]
  fire: (channel: string, payload: unknown) => void
}

let fake: Fake

/**
 * This Machine's preload. A window on M sends M's `project` channels through `linked.invoke`; they
 * answer from `onM`, the Project list as LIST, anything else with a refusal.
 */
function preload(readOnly: boolean, onM: Record<string, unknown> = {}): Fake {
  const calls: string[] = []
  const sent: string[] = []
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      calls.push(channel)
      if (channel === 'link.state') return Promise.resolve({ ok: true, value: linkState })
      if (channel === 'linked.state') return Promise.resolve({ ok: true, value: linkedState(readOnly) })
      if (channel === 'linked.invoke') {
        const call = input as { channel: string }
        sent.push(call.channel)
        calls.push(call.channel)
        const answer = call.channel === 'projects.list' ? { ok: true, value: LIST } : call.channel in onM ? { ok: true, value: onM[call.channel] } : { ok: false, error: `${call.channel}: not in this test` }
        return Promise.resolve({ ok: true, value: answer })
      }
      return Promise.resolve({ ok: false, error: `${channel}: not in this test` })
    },
    on: (channel, handler) => {
      handlers.set(next, { channel, handler })
      return next++
    },
    off: (id) => void handlers.delete(id),
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return {
    calls,
    sent,
    fire: (channel, payload) => {
      for (const { channel: name, handler } of [...handlers.values()]) if (name === channel) handler(payload)
    },
  }
}

/**
 * A fresh renderer in a window on `machine` (null — this Machine) whose main says M is read-only or
 * not. The level and the name are in the stores before the test draws anything, as after the first
 * answers of main.
 */
async function windowOn(machine: string | null, readOnly: boolean, onM: Record<string, unknown> = {}) {
  window.history.replaceState(null, '', machine === null ? '/' : `/?machine=${machine}&project=${PROJECT}`)
  fake = preload(readOnly, onM)
  vi.resetModules()
  const projects = await import('../../src/renderer/projects/useProjects')
  const machines = await import('../../src/renderer/machines/useMachines')
  machines.acceptLinkState(linkState)
  projects.acceptLinkedState(linkedState(readOnly))
  projects.acceptProjectsState(LIST)
  return { projects }
}

beforeEach(() => {
  resizer.drawn = 0
  terminal.mounted = 0
  locked.levels = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Expects an action to be inactive with the read-only hint as its tooltip. */
function expectInactive(element: HTMLElement): void {
  expect(element.getAttribute('aria-disabled')).toBe('true')
  expect(element.getAttribute('title')).toBe(HINT)
}

describe('useReadOnly and readOnlyNow', () => {
  it('a window on a read-only Linked machine: the hint names the Machine', async () => {
    const { projects } = await windowOn(M, true)
    const hook = renderHook(() => projects.useReadOnly())
    expect(hook.result.current).toBe(HINT)
    const { readOnlyNow } = await import('../../src/renderer/projects/read-only-now')
    expect(readOnlyNow()).toBe(HINT)
  })

  it('a window on a Linked machine with Full access, and a window on this Machine: null', async () => {
    const full = await windowOn(M, false)
    expect(renderHook(() => full.projects.useReadOnly()).result.current).toBeNull()
    cleanup()
    const own = await windowOn(null, true)
    expect(renderHook(() => own.projects.useReadOnly()).result.current).toBeNull()
    // This Machine's own Projects are never read-only: the hook asks main nothing for them.
    expect(fake.calls).not.toContain('linked.state')
    expect(fake.calls).not.toContain('link.state')
  })

  it('follows the level as main learns it, without loading the window again', async () => {
    const { projects } = await windowOn(M, true)
    const hook = renderHook(() => projects.useReadOnly())
    expect(hook.result.current).toBe(HINT)
    act(() => fake.fire('linked.changed', linkedState(false, 2)))
    expect(hook.result.current).toBeNull()
    act(() => fake.fire('linked.changed', linkedState(true, 3)))
    expect(hook.result.current).toBe(HINT)
  })

  it('the sidebar group of a read-only Machine is marked; of a Machine with Full access and of this one, not', async () => {
    const { projects } = await windowOn(null, true)
    const groups = projects.groupProjects({ windowMachine: null, windowState: undefined, link: linkState, linked: linkedState(true), lists: {} })
    expect(groups?.map((group) => [group.name, group.readOnly])).toEqual([
      ['Studio', false],
      ['Mini', true],
    ])
    const full = projects.groupProjects({ windowMachine: null, windowState: undefined, link: linkState, linked: linkedState(false), lists: {} })
    expect(full?.map((group) => group.readOnly)).toEqual([false, false])
  })
})

describe('what sends stops before the call', () => {
  const NOTE: LayoutNode = { id: 'note-1', kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: 'hi' }, hidden: false, pinned: null, tags: [] } as unknown as LayoutNode

  it('a Layout operation: read-only — the hint, and no layout.apply; Full access — sent', async () => {
    await windowOn(M, true)
    const { sendLayoutOp } = await import('../../src/renderer/canvas/useLayout')
    expect(await sendLayoutOp(PROJECT, { op: 'move', id: 'note-1', x: 10, y: 10 })).toBe(HINT)
    expect(fake.sent).not.toContain('layout.apply')

    await windowOn(M, false, { 'layout.apply': { projectId: PROJECT, layout: { nodes: [], edges: [] }, revision: 2 } })
    const again = await import('../../src/renderer/canvas/useLayout')
    expect(await again.sendLayoutOp(PROJECT, { op: 'move', id: 'note-1', x: 10, y: 10 })).toEqual({ revision: 2 })
    expect(fake.sent).toEqual(['layout.apply'])
  })

  it('deleting to the trash: read-only — one hint, the trash is not called; Full access — it is', async () => {
    await windowOn(M, true)
    const history = await import('../../src/renderer/canvas/history')
    const trash = { put: vi.fn(() => Promise.resolve({ ok: false as const, error: 'gone' })), restore: vi.fn() }
    expect(await history.deleteToTrash(PROJECT, [NOTE, { ...NOTE, id: 'note-2' }], trash)).toEqual([HINT])
    expect(await history.trashRecorded(PROJECT, 'note-1', trash)).toBe(HINT)
    expect(trash.put).not.toHaveBeenCalled()

    await windowOn(M, false)
    const full = await import('../../src/renderer/canvas/history')
    await full.deleteToTrash(PROJECT, [NOTE], trash)
    expect(trash.put).toHaveBeenCalledTimes(1)
  })

  it('the default trash client sends nothing to M on a read-only screen', async () => {
    await windowOn(M, true)
    const history = await import('../../src/renderer/canvas/history')
    await history.deleteToTrash(PROJECT, [NOTE])
    expect(fake.sent.filter((channel) => channel.startsWith('trash.'))).toEqual([])
  })

  it('⌘Z and ⇧⌘Z: read-only — nothing is undone and the step stays; Full access — it is undone', async () => {
    const { projects } = await windowOn(M, true)
    const history = await import('../../src/renderer/canvas/history')
    const undo = vi.fn(() => Promise.resolve(undefined))
    const redo = vi.fn(() => Promise.resolve(undefined))
    history.record(PROJECT, { undo, redo })
    expect(await history.historyOf(PROJECT).undo()).toBe(false)
    expect(undo).not.toHaveBeenCalled()
    expect(history.historyOf(PROJECT).canUndo).toBe(true)
    // The level changes to Full access while the window stays.
    act(() => projects.acceptLinkedState(linkedState(false, 2)))
    expect(await history.historyOf(PROJECT).undo()).toBe(true)
    expect(undo).toHaveBeenCalledTimes(1)
    act(() => projects.acceptLinkedState(linkedState(true, 3)))
    expect(await history.historyOf(PROJECT).redo()).toBe(false)
    expect(redo).not.toHaveBeenCalled()
  })

  it('a manual Binding: read-only — the hint, and no bindings.set or bindings.remove', async () => {
    await windowOn(M, true)
    const bindings = await import('../../src/renderer/binding/store')
    const agent = { kind: 'session', sessionId: 's1' } as unknown as Parameters<typeof bindings.bindManually>[1]
    const target = { kind: 'epic', epic: 'shop' } as unknown as Parameters<typeof bindings.bindManually>[2]
    expect(await bindings.bindManually(PROJECT, agent, target)).toBe(HINT)
    expect(await bindings.removeManualBinding(PROJECT, agent)).toBe(HINT)
    expect(fake.sent.filter((channel) => channel.startsWith('bindings.'))).toEqual([])
  })

  it('"Go to Orchestrator": read-only — the Session view shows, orchestrator.open is not called', async () => {
    await windowOn(M, true)
    const navigation = await import('../../src/renderer/session/navigation')
    expect(await navigation.openOrchestrator(PROJECT)).toBeUndefined()
    expect(navigation.useNavigation.getState().view).toBe('session')
    expect(fake.sent).not.toContain('orchestrator.open')
  })
})

/**
 * Gives every element a size, as canvas.test.tsx does: jsdom lays nothing out, and React Flow draws
 * only the Nodes inside its pane (`onlyRenderVisibleElements`). Returns the function that undoes it.
 */
function sizeTheCanvas(): () => void {
  const restore: (() => void)[] = []
  for (const [name, value] of [
    ['offsetWidth', 1200],
    ['offsetHeight', 800],
  ] as const) {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value })
    restore.push(() => {
      if (before) Object.defineProperty(HTMLElement.prototype, name, before)
    })
  }
  return () => {
    for (const undo of restore) undo()
  }
}

describe('the Canvas', () => {
  it('read-only: the root is marked and the notice says why; Full access: neither', async () => {
    await windowOn(M, true)
    const { default: ReadOnlyCanvas, READ_ONLY_ATTRIBUTE } = await import('../../src/renderer/canvas/overlays/ReadOnlyCanvas')
    const view = render(
      <ReactFlowProvider>
        <ReactFlow nodes={[]} edges={[]}>
          <ReadOnlyCanvas />
        </ReactFlow>
      </ReactFlowProvider>,
    )
    await waitFor(() => expect(view.container.querySelector('.react-flow')?.hasAttribute(READ_ONLY_ATTRIBUTE)).toBe(true))
    expect(screen.getByTestId('canvas-read-only').textContent).toBe(HINT)
    view.unmount()

    await windowOn(M, false)
    const full = await import('../../src/renderer/canvas/overlays/ReadOnlyCanvas')
    const fullView = render(
      <ReactFlowProvider>
        <ReactFlow nodes={[]} edges={[]}>
          <full.default />
        </ReactFlow>
      </ReactFlowProvider>,
    )
    expect(screen.queryByTestId('canvas-read-only')).toBeNull()
    expect(fullView.container.querySelector('.react-flow')?.hasAttribute(full.READ_ONLY_ATTRIBUTE)).toBe(false)
  })

  it('read-only: a Node does not drag; once the level changes to Full access it drags again, and stops on the way back', async () => {
    const restore = sizeTheCanvas()
    try {
      const note = { id: 'note-1', kind: 'note', x: 0, y: 0, w: 200, h: 100, hidden: false, locked: false, pinned: false, tags: [], data: { text: 'hi' } }
      const { projects } = await windowOn(M, true, { 'layout.get': { projectId: PROJECT, revision: 1, layout: { nodes: [note], viewport: { x: 0, y: 0, zoom: 1 } } } })
      const { Canvas } = await import('../../src/renderer/canvas/Canvas')
      render(<Canvas projectId={PROJECT} />)
      // React Flow marks the wrapper of a Node it lets the mouse drag with the class `draggable`.
      const draggable = () => document.querySelector('.react-flow__node[data-id="note-1"]')?.classList.contains('draggable')
      await waitFor(() => expect(draggable()).toBe(false))
      expect(locked.levels.at(-1)).toBe(HINT)
      act(() => projects.acceptLinkedState(linkedState(false, 2)))
      await waitFor(() => expect(draggable()).toBe(true))
      expect(locked.levels.at(-1)).toBeNull()
      act(() => projects.acceptLinkedState(linkedState(true, 3)))
      await waitFor(() => expect(draggable()).toBe(false))
      expect(locked.levels.at(-1)).toBe(HINT)
    } finally {
      restore()
    }
  })

  it('read-only: a Node that asks to be dragged on its own (a Subagent) does not drag either; Full access: the Nodes are as given', async () => {
    const { lockedForReadOnly } = await import('../../src/renderer/canvas/read-only-nodes')
    const nodes = [
      { id: 'agent', position: { x: 0, y: 0 }, draggable: true, data: {} },
      { id: 'ticket', position: { x: 0, y: 0 }, draggable: false, data: {} },
      { id: 'note', position: { x: 0, y: 0 }, data: {} },
    ] as unknown as Parameters<typeof lockedForReadOnly>[0]
    expect(lockedForReadOnly(nodes, HINT).map((node) => node.draggable)).toEqual([false, false, undefined])
    expect(lockedForReadOnly(nodes, null)).toBe(nodes)
  })

  it('read-only: no resize handles; Full access: the handles are there', async () => {
    await windowOn(M, true)
    const { NodeResizeClamp } = await import('../../src/renderer/canvas/NodeResizeClamp')
    render(
      <ReactFlowProvider>
        <NodeResizeClamp isVisible />
      </ReactFlowProvider>,
    )
    expect(resizer.drawn).toBe(0)
    cleanup()
    await windowOn(M, false)
    const full = await import('../../src/renderer/canvas/NodeResizeClamp')
    render(
      <ReactFlowProvider>
        <full.NodeResizeClamp isVisible />
      </ReactFlowProvider>,
    )
    expect(resizer.drawn).toBeGreaterThan(0)
  })

  it('read-only: a Terminal Node is drawn as a stand-in and its own component — which opens the shell — never mounts', async () => {
    const terminalNode = (): Parameters<typeof import('../../src/renderer/canvas/NodeChrome').NodeChrome>[0] =>
      ({
        id: 'term-1',
        data: { node: { id: 'term-1', kind: 'terminal', x: 0, y: 0, w: 560, h: 340, data: {}, tags: [], pinned: null, hidden: false } },
        selected: false,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      }) as never
    const Terminal = vi.fn(() => <div data-testid="terminal-node" />)

    await windowOn(M, true)
    const { NodeChrome } = await import('../../src/renderer/canvas/NodeChrome')
    render(<NodeChrome {...terminalNode()} Component={Terminal} />)
    expect(Terminal).not.toHaveBeenCalled()
    expect(screen.getByTestId('terminal-node-read-only').textContent).toContain(HINT)
    expect(fake.sent).not.toContain('terminal.open')
    cleanup()

    await windowOn(M, false)
    const full = await import('../../src/renderer/canvas/NodeChrome')
    render(<full.NodeChrome {...terminalNode()} Component={Terminal} />)
    expect(Terminal).toHaveBeenCalled()
    expect(screen.getByTestId('terminal-node')).toBeTruthy()
  })

  it('read-only: the Canvas menu opens with every item inactive and creates nothing', async () => {
    await windowOn(M, true)
    const { default: CanvasMenu } = await import('../../src/renderer/canvas/overlays/CanvasMenu')
    const { LayoutOpsContext } = await import('../../src/renderer/canvas/useLayout')
    const apply = vi.fn(() => Promise.resolve())
    render(
      <ReactFlowProvider>
        <LayoutOpsContext.Provider value={{ apply }}>
          <ReactFlow nodes={[]} edges={[]}>
            <CanvasMenu />
          </ReactFlow>
        </LayoutOpsContext.Provider>
      </ReactFlowProvider>,
    )
    const pane = document.querySelector('.react-flow__pane')!
    await waitFor(() => {
      fireEvent.contextMenu(pane, { clientX: 40, clientY: 40 })
      expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(1)
    })
    for (const item of screen.getAllByRole('menuitem')) {
      expectInactive(item)
      fireEvent.click(item)
    }
    expect(apply).not.toHaveBeenCalled()
  })

  it('read-only: the trash shows its entries and Restore is inactive; Full access: Restore asks M', async () => {
    const entry = { label: 'entry-1', trashedAt: Date.now(), nodeId: 'note-1', kind: 'note', title: 'hi', hasFiles: false }
    const draw = async (readOnly: boolean) => {
      await windowOn(M, readOnly, { 'trash.list': { entries: [entry] } })
      const { default: TrashPopover } = await import('../../src/renderer/canvas/overlays/TrashPopover')
      render(
        <ReactFlowProvider>
          <TrashPopover />
        </ReactFlowProvider>,
      )
      fireEvent.click(await screen.findByRole('button', { name: /Trash/ }))
      return screen.findByRole('button', { name: 'Restore' })
    }
    const restore = await draw(true)
    expectInactive(restore)
    fireEvent.click(restore)
    expect(fake.sent).not.toContain('trash.restore')
    cleanup()

    const active = await draw(false)
    expect(active.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(active)
    await waitFor(() => expect(fake.sent).toContain('trash.restore'))
  })

  it('read-only: a note can be read, not edited', async () => {
    await windowOn(M, true)
    const { default: NoteNode } = await import('../../src/renderer/canvas/nodes/NoteNode')
    render(
      <ReactFlowProvider>
        <NoteNode {...({ id: 'note-1', data: { node: { id: 'note-1', kind: 'note', data: { text: 'hi' }, tags: [] } }, selected: false } as unknown as CanvasNodeProps)} />
      </ReactFlowProvider>,
    )
    const text = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement
    expect(text.readOnly).toBe(true)
    expect(text.title).toBe(HINT)
  })
})

describe('a Session', () => {
  const request: Extract<AgentEvent, { type: 'permission_request' }> = {
    type: 'permission_request',
    requestId: 'req-1',
    toolName: 'Bash',
    toolUseId: 'toolu_1',
    input: { command: 'git push' },
    title: null,
    description: 'Push the branch',
    blockedPath: null,
    alwaysAllow: true,
    suggestions: [],
  }

  it('read-only: a permission request shows, and Allow, Always allow and Deny are inactive; Full access: Allow answers', async () => {
    await windowOn(M, true)
    const { PermissionCard } = await import('../../src/renderer/session/PermissionCard')
    render(<PermissionCard request={request} sessionId="sdk-7" />)
    for (const name of ['Allow', 'Always allow', 'Deny']) {
      const button = screen.getByRole('button', { name })
      expectInactive(button)
      fireEvent.click(button)
    }
    expect(fake.sent).not.toContain('agent.permission')
    cleanup()

    await windowOn(M, false, { 'agent.permission': { answered: true } })
    const full = await import('../../src/renderer/session/PermissionCard')
    render(<full.PermissionCard request={request} sessionId="sdk-7" />)
    const allow = screen.getByRole('button', { name: 'Allow' })
    expect(allow.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(allow)
    await waitFor(() => expect(fake.sent).toContain('agent.permission'))
  })
})

describe('the Session view, the sidebar and the Orchestrator', () => {
  it('read-only: the message field is off and says why, Interrupt is inactive; Full access: the field takes a message', async () => {
    const draw = async (readOnly: boolean) => {
      await windowOn(M, readOnly)
      const { MessageInput } = await import('../../src/renderer/session/MessageInput')
      const onSend = vi.fn(() => Promise.resolve(null))
      const onInterrupt = vi.fn()
      render(<MessageInput sessionId="sdk-7" busy history={[]} recipient="Orchestrator" onSend={onSend} onInterrupt={onInterrupt} />)
      return { field: screen.getByRole('textbox', { name: 'Message Orchestrator' }) as HTMLTextAreaElement, interrupt: screen.getByTestId('input-interrupt'), onInterrupt }
    }
    const shown = await draw(true)
    expect(shown.field.disabled).toBe(true)
    expect(shown.field.placeholder).toBe(HINT)
    expectInactive(shown.interrupt)
    fireEvent.click(shown.interrupt)
    expect(shown.onInterrupt).not.toHaveBeenCalled()
    expect(screen.getByTestId('input-attach').getAttribute('title')).toBe(HINT)
    cleanup()

    const full = await draw(false)
    expect(full.field.disabled).toBe(false)
    fireEvent.click(full.interrupt)
    expect(full.onInterrupt).toHaveBeenCalledTimes(1)
  })

  it('read-only: "New session" in the sidebar is inactive and starts nothing; Full access: it asks M', async () => {
    const draw = async (readOnly: boolean) => {
      await windowOn(M, readOnly)
      const { default: SessionsSection } = await import('../../src/renderer/shell/sidebar/SessionsSection')
      render(<SessionsSection />)
      return screen.findByTestId('sidebar-new-session')
    }
    const inactive = await draw(true)
    expectInactive(inactive)
    fireEvent.click(inactive)
    expect(fake.sent).not.toContain('sessions.new')
    cleanup()

    const active = await draw(false)
    expect(active.getAttribute('title')).toBe("A new Session in the Project's root")
    fireEvent.click(active)
    await waitFor(() => expect(fake.sent).toContain('sessions.new'))
  })

  it('read-only: the history shows the Sessions, Resume is inactive and resumes nothing', async () => {
    const session = { sessionId: 's-1', title: 'one', size: 10, modifiedAt: 1, live: false }
    await windowOn(M, true, {
      'claudeHome.sessions': { live: [], history: [session] },
      'claudeHome.live': { live: [] },
      'sessions.resumable': { verdicts: { 's-1': { resumable: true, cwd: '/repos/shop' } } },
      'layout.get': { projectId: PROJECT, layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, revision: 1 },
    })
    const { HistoryPopover } = await import('../../src/renderer/session/HistoryPopover')
    render(<HistoryPopover project={{ id: PROJECT, name: 'shop', path: '/repos/shop', branch: 'main' }} onClose={() => undefined} />)
    const resume = await screen.findByTestId('history-resume')
    await waitFor(() => expect((resume as HTMLButtonElement).disabled).toBe(false))
    expectInactive(resume)
    fireEvent.click(resume)
    // Show would put the Session's Node on the Canvas: inactive too.
    expectInactive(screen.getByTestId('history-show'))
    expect(fake.sent).not.toContain('sessions.resume')
  })

  it('read-only: Show of a Session whose Node is archived is inactive with the hint; of one whose Node is shown, it only focuses and stays active', async () => {
    const row = (sessionId: string) => ({ sessionId, title: sessionId, size: 10, modifiedAt: 1, live: false })
    const sessionNode = (id: string, sessionId: string, archived: LayoutNode['archived']) => ({ id, kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { sessionId }, archived })
    await windowOn(M, true, {
      'claudeHome.sessions': { live: [], history: [row('s-shown'), row('s-archived')] },
      'claudeHome.live': { live: [] },
      'sessions.resumable': { verdicts: {} },
      'layout.get': {
        projectId: PROJECT,
        layout: { nodes: [sessionNode('n-shown', 's-shown', null), sessionNode('n-archived', 's-archived', { at: 1, rule: 'idle', batch: 'b1' })], viewport: { x: 0, y: 0, zoom: 1 } },
        revision: 1,
      },
    })
    const { HistoryPopover } = await import('../../src/renderer/session/HistoryPopover')
    render(<HistoryPopover project={{ id: PROJECT, name: 'shop', path: '/repos/shop', branch: 'main' }} onClose={() => undefined} />)
    const showOf = async (sessionId: string) => {
      const rows = await screen.findAllByTestId('history-session')
      return within(rows.find((each) => each.getAttribute('data-session-id') === sessionId)!).getByTestId('history-show')
    }
    // Once the Layout is read, the shown Node's Show is active: it only focuses.
    await waitFor(async () => expect((await showOf('s-shown')).getAttribute('aria-disabled')).not.toBe('true'))
    // Show of the archived one would restore it: a write, inactive here.
    expectInactive(await showOf('s-archived'))
    fireEvent.click(await showOf('s-archived'))
    expect(fake.sent).not.toContain('layout.apply')
  })

  it('read-only: the Orchestrator Node shows, "New conversation" is inactive', async () => {
    const view = { projectId: PROJECT, nodeId: 'orch', sessionId: 'pending-1', state: 'idle', error: null, model: 'claude-opus-5-5', costUsd: 0, statusBlock: null, version: 1 }
    await windowOn(M, true, { 'orchestrator.view': { view } })
    const { default: OrchestratorNode } = await import('../../src/renderer/canvas/nodes/OrchestratorNode')
    render(
      <ReactFlowProvider>
        <OrchestratorNode {...({ id: 'orch', data: { node: { data: {} } }, selected: false } as unknown as CanvasNodeProps)} />
      </ReactFlowProvider>,
    )
    const button = screen.getByTestId('orchestrator-new-conversation')
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    expectInactive(button)
    fireEvent.click(button)
    expect(fake.sent).not.toContain('orchestrator.newConversation')
  })
})

describe('the selection toolbar, the Command palette and Focus mode', () => {
  const TAGGED = { id: 'note-1', kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: 'hi' }, hidden: false, locked: false, pinned: false, tags: ['plan'] } as unknown as LayoutNode

  it('read-only: Pin, Add tag, removing a tag and Delete are inactive with the hint and send nothing; Full access: they act', async () => {
    const draw = async (readOnly: boolean) => {
      await windowOn(M, readOnly)
      const toolbar = await import('../../src/renderer/canvas/overlays/SelectionToolbar')
      const { LayoutOpsContext } = await import('../../src/renderer/canvas/useLayout')
      const apply = vi.fn(() => Promise.resolve())
      render(
        <ReactFlowProvider>
          <LayoutOpsContext.Provider value={{ apply }}>
            <toolbar.PinSection nodes={[TAGGED]} />
            <toolbar.TagsSection nodes={[TAGGED]} />
            <toolbar.DeleteSection nodes={[TAGGED]} />
          </LayoutOpsContext.Provider>
        </ReactFlowProvider>,
      )
      const buttons = {
        pin: screen.getByRole('button', { name: 'Pin' }),
        add: screen.getByRole('button', { name: 'Add tag' }),
        remove: screen.getByRole('button', { name: 'Remove tag plan' }),
        delete: screen.getByRole('button', { name: 'Delete' }),
      }
      return { apply, buttons }
    }

    const shown = await draw(true)
    for (const button of [shown.buttons.pin, shown.buttons.add, shown.buttons.remove, shown.buttons.delete]) {
      expectInactive(button)
      fireEvent.click(button)
    }
    // Add tag opens no field, Delete shows no refusal: nothing was tried.
    expect(screen.queryByRole('textbox', { name: 'New tag' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(shown.apply).not.toHaveBeenCalled()
    expect(fake.sent.filter((channel) => channel.startsWith('trash.'))).toEqual([])
    cleanup()

    const full = await draw(false)
    for (const button of [full.buttons.pin, full.buttons.add, full.buttons.remove, full.buttons.delete]) expect(button.getAttribute('aria-disabled')).toBeNull()
    expect(full.buttons.pin.getAttribute('title')).toBe('Keep the selection at its place on the screen')
    expect(full.buttons.delete.getAttribute('title')).toBe('Move to the trash (Delete)')
    fireEvent.click(full.buttons.pin)
    await waitFor(() => expect(full.apply).toHaveBeenCalledTimes(1))
    fireEvent.click(full.buttons.remove)
    await waitFor(() => expect(full.apply).toHaveBeenCalledTimes(2))
    fireEvent.click(full.buttons.delete)
    await waitFor(() => expect(fake.sent).toContain('trash.put'))
    fireEvent.click(full.buttons.add)
    expect(screen.getByRole('textbox', { name: 'New tag' })).toBeTruthy()
  })

  it('read-only: "Show family" stays active beside the inactive Pin — it only moves the camera', async () => {
    await windowOn(M, true)
    const toolbar = await import('../../src/renderer/canvas/overlays/SelectionToolbar')
    const focus = await import('../../src/renderer/canvas/edge-focus')
    const ticket = { id: 'ticket:demo/1', kind: 'ticket', x: 0, y: 0, w: 220, h: 120, data: {}, hidden: false, locked: false, pinned: false, tags: [] } as unknown as LayoutNode
    focus.setEdgeFocus([], [], { epics: ['demo'], tickets: [{ epic: 'demo', num: 1 }], sessions: [], subagents: [], bindings: [] })
    try {
      render(
        <ReactFlowProvider>
          <toolbar.PinSection nodes={[ticket]} />
          <toolbar.FamilySection nodes={[ticket]} />
        </ReactFlowProvider>,
      )
      expectInactive(screen.getByRole('button', { name: 'Pin' }))
      const show = screen.getByRole('button', { name: 'Show family' })
      expect(show.getAttribute('aria-disabled')).toBeNull()
      expect((show as HTMLButtonElement).disabled).toBe(false)
      fireEvent.click(show)
      // Nothing is sent but the read of the Project list: Show family reads which Project is active.
      expect(fake.sent.filter((channel) => channel !== 'projects.list')).toEqual([])
    } finally {
      focus.clearEdgeFocus()
    }
  })

  it('read-only: "New session" and "Tidy up" in the Command palette are inactive with the hint and run nothing; Full access: active', async () => {
    // jsdom has no scrollIntoView; the palette calls it for the active row.
    Element.prototype.scrollIntoView = () => undefined
    const draw = async (readOnly: boolean) => {
      await windowOn(M, readOnly)
      const { CommandPalette } = await import('../../src/renderer/palette/CommandPalette')
      render(<CommandPalette />)
      fireEvent.click(screen.getByTestId('palette-trigger'))
      const row = (id: string) => document.querySelector<HTMLElement>(`[data-command="${id}"]`)!
      await waitFor(() => expect(row('new:session')).not.toBeNull())
      return row
    }
    try {
      const row = await draw(true)
      for (const id of ['new:session', 'tidy-up']) {
        expectInactive(row(id))
        expect(within(row(id)).getByTestId('palette-option-note').textContent).toBe(HINT)
      }
      fireEvent.click(row('new:session'))
      expect(screen.getByTestId('command-palette')).toBeTruthy()
      expect(fake.sent).not.toContain('sessions.new')
      // What only moves or shows something stays active.
      expect(row('view:session').getAttribute('aria-disabled')).toBe('false')
      cleanup()

      const full = await draw(false)
      expect(full('new:session').getAttribute('aria-disabled')).toBe('false')
      expect(full('tidy-up').getAttribute('aria-disabled')).toBe('false')
      fireEvent.click(full('new:session'))
      await waitFor(() => expect(fake.sent).toContain('sessions.new'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('read-only: Focus mode draws a Terminal as the stand-in and never mounts the Terminal, which opens the shell; Full access: the Terminal', async () => {
    const tile = (): CanvasFlowNode => ({
      id: 'term-1',
      position: { x: 0, y: 0 },
      data: { node: { id: 'term-1', kind: 'terminal', x: 0, y: 0, w: 560, h: 340, data: {}, tags: [], pinned: false, locked: false, hidden: false } as unknown as LayoutNode },
    })
    const draw = async (readOnly: boolean) => {
      await windowOn(M, readOnly)
      const { FocusMode } = await import('../../src/renderer/focus/FocusMode')
      const { buildPreset } = await import('../../src/renderer/focus/split-tree')
      render(
        <ReactFlowProvider initialNodes={[tile()]}>
          <FocusMode tree={buildPreset('columns', ['term-1'])!} onChange={() => undefined} onExit={() => undefined} />
        </ReactFlowProvider>,
      )
    }
    await draw(true)
    expect(screen.getByTestId('terminal-node-read-only').textContent).toContain(HINT)
    expect(terminal.mounted).toBe(0)
    expect(fake.sent).not.toContain('terminal.open')
    cleanup()

    await draw(false)
    expect(screen.getByTestId('terminal-node')).toBeTruthy()
    expect(terminal.mounted).toBeGreaterThan(0)
    expect(screen.queryByTestId('terminal-node-read-only')).toBeNull()
  })
})
