// "Show" on an archived Node (worfy-canvas ticket 14, ADR-0076): the history of Sessions
// (session/HistoryPopover.tsx), a row of the sidebar's Sessions (shell/sidebar/SessionsSection.tsx)
// and a "go to" command of the palette (palette/commands.ts) bring the Node back through `restore`
// before they focus it, as one step of the Project's undo history: ⌘Z archives it again, with the
// rule and the batch it had. A fake main keeps the Layout and applies the operations it is sent.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { HistorySession, LiveSession } from '../../src/shared/ipc/claude-home'
import type { ArchiveRecord, LayoutNode, LayoutOpInput, LayoutState } from '../../src/shared/layout/types'

const PROJECT_ID = 'demo-0000000a'
const ROOT = '/Users/test/projects/demo'
const LIST = { projects: [{ id: PROJECT_ID, name: 'demo', path: ROOT, branch: 'main' }], activeId: PROJECT_ID, revision: 1 }
const SESSION = 'S-archived'
const RECORD: ArchiveRecord = { at: 1000, rule: 'ticket-done', batch: 'batch-7' }

const sessionNode = (over: Partial<LayoutNode> = {}): LayoutNode => ({
  id: 'node-s',
  kind: 'session',
  x: 40,
  y: 40,
  w: 300,
  h: 120,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data: { origin: 'worfy', sessionId: SESSION },
  archived: RECORD,
  ...over,
})

const historyRow: HistorySession = { sessionId: SESSION, title: 'Old work', size: 10, modifiedAt: 1, live: false }
const liveRow: LiveSession = { pid: 42, sessionId: SESSION, cwd: ROOT, status: 'idle', entrypoint: 'cli' }

interface Main {
  nodes: LayoutNode[]
  revision: number
  /** The Layout operations sent, in order, with the screen they came from. */
  applied: { op: LayoutOpInput; screen: string | undefined }[]
}

let main: Main

const state = (): LayoutState => ({ projectId: PROJECT_ID, layout: { nodes: main.nodes, viewport: { x: 0, y: 0, zoom: 1 } }, revision: main.revision })

/** main's `layout.apply`, as far as these tests need it. */
function apply(op: LayoutOpInput): void {
  const change = (id: string, next: (node: LayoutNode) => LayoutNode) => {
    main.nodes = main.nodes.map((node) => (node.id === id ? next(node) : node))
  }
  // main puts a restored Node off a Node that took its place (ADR-0038); here, always 200 lower.
  if (op.op === 'restore') for (const id of op.ids) change(id, (node) => ({ ...node, archived: null, y: node.y + 200 }))
  else if (op.op === 'archive') for (const { id, rule, at } of op.nodes) change(id, (node) => ({ ...node, archived: { at: at ?? 2000, rule, batch: op.batch } }))
  else if (op.op === 'hide') change(op.id, (node) => ({ ...node, hidden: op.hidden }))
  else if (op.op === 'move') change(op.id, (node) => ({ ...node, x: op.x, y: op.y }))
  // Opening a Session in the Session view marks its Node as used (navigation.ts): nothing to keep here.
  else if (op.op === 'touch') return
  else throw new Error(`not in this test: ${op.op}`)
  main.revision += 1
}

/** What main answers to `sessions.resume` (session/HistoryPopover.tsx): the Session goes on, on its Node. */
const resumedView = { projectId: PROJECT_ID, nodeId: 'node-s', sessionId: 'live-1', sdkSessionId: SESSION, state: 'starting', error: null, cwd: ROOT, model: null, version: 1 }

function preload(live: LiveSession[]): void {
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      if (channel === 'layout.apply') {
        const { op, screen } = input as { op: LayoutOpInput; screen?: string }
        main.applied.push({ op, screen })
        apply(op)
        return Promise.resolve({ ok: true, value: state() })
      }
      const value: unknown =
        channel === 'layout.get'
          ? state()
          : channel === 'projects.list'
            ? LIST
            : channel === 'claudeHome.sessions'
              ? { live, history: [historyRow] }
              : channel === 'claudeHome.live'
                ? { live }
                : channel === 'sessions.views'
                  ? { views: [] }
                  : channel === 'sessions.resumable'
                    ? { verdicts: { [SESSION]: { resumable: true, cwd: ROOT } } }
                    : channel === 'sessions.resume'
                      ? resumedView
                      : undefined
      return Promise.resolve(value === undefined ? { ok: false, error: `no ${channel}` } : { ok: true, value })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

beforeEach(() => {
  vi.resetModules()
  main = { nodes: [sessionNode()], revision: 1, applied: [] }
  preload([])
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const ops = () => main.applied.map(({ op }) => op)

/** ⌘Z on the Project's Canvas: the undo of its history. */
async function undo(): Promise<void> {
  const { historyOf } = await import('../../src/renderer/canvas/history')
  await expect(historyOf(PROJECT_ID).undo()).resolves.toBe(true)
}

/** After ⌘Z: the Node is archived again with its whole record and moved back to its old place, by the Show's own step. */
async function expectUndoArchives(): Promise<void> {
  await undo()
  expect(ops().slice(-2)).toEqual([
    { op: 'archive', batch: RECORD.batch, nodes: [{ id: 'node-s', rule: RECORD.rule, at: RECORD.at }] },
    { op: 'move', id: 'node-s', x: 40, y: 40 },
  ])
  expect(main.nodes[0]).toMatchObject({ x: 40, y: 40, archived: RECORD })
}

describe('Show of an archived Node', () => {
  it('the history of Sessions restores it, then focuses it; ⌘Z archives it again', async () => {
    const { HistoryPopover } = await import('../../src/renderer/session/HistoryPopover')
    const { useSessionFocus } = await import('../../src/renderer/claude-home/focus')
    render(<HistoryPopover project={LIST.projects[0]!} onClose={() => undefined} />)
    const row = await screen.findByTestId('history-session')
    // The Layout is read before the click: the Node is known as archived.
    await waitFor(() => expect(within(row).getByTestId('history-show').getAttribute('aria-disabled')).not.toBe('true'))
    await act(async () => {
      fireEvent.click(within(row).getByTestId('history-show'))
      await waitFor(() => expect(useSessionFocus.getState().request).toMatchObject({ projectId: PROJECT_ID, nodeId: 'node-s' }))
    })
    expect(ops()).toEqual([{ op: 'restore', ids: ['node-s'] }])
    expect(main.applied[0]!.screen).toEqual(expect.any(String))
    expect(main.nodes[0]!.archived).toBeNull()
    await expectUndoArchives()
  })

  it('a row of the sidebar\'s Sessions restores it, then focuses it; ⌘Z archives it again', async () => {
    preload([liveRow])
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(LIST)
    const { default: SessionsSection } = await import('../../src/renderer/shell/sidebar/SessionsSection')
    const { useLayout } = await import('../../src/renderer/canvas/useLayout')
    const { useSessionFocus } = await import('../../src/renderer/claude-home/focus')
    function LayoutReady() {
      return useLayout(PROJECT_ID).state === undefined ? null : <span data-testid="layout-ready" />
    }
    render(
      <>
        <SessionsSection />
        <LayoutReady />
      </>,
    )
    await screen.findByTestId('layout-ready')
    await act(async () => {
      fireEvent.click(await screen.findByTestId('sidebar-session'))
      await waitFor(() => expect(useSessionFocus.getState().request).toMatchObject({ projectId: PROJECT_ID, nodeId: 'node-s' }))
    })
    expect(ops()).toEqual([{ op: 'restore', ids: ['node-s'] }])
    await expectUndoArchives()
  })

  it('on a read-only screen the sidebar row of an archived Node is inactive with the hint, and a click sends nothing', async () => {
    const HINT = 'Mini gives this Machine read-only access'
    preload([liveRow])
    vi.doMock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
      useReadOnly: () => HINT,
    }))
    onTestFinished(() => void vi.doUnmock('../../src/renderer/projects/useProjects'))
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(LIST)
    const { default: SessionsSection } = await import('../../src/renderer/shell/sidebar/SessionsSection')
    render(<SessionsSection />)
    const row = await screen.findByTestId('sidebar-session')
    // The Layout is read: the Node is known as archived.
    await waitFor(() => expect(row.getAttribute('aria-disabled')).toBe('true'))
    expect(row.getAttribute('title')).toBe(HINT)
    fireEvent.click(row)
    expect(ops()).toEqual([])
  })

  it('on a read-only screen the sidebar row of a Node already on the Canvas stays active: a click only focuses it', async () => {
    main.nodes = [sessionNode({ archived: null })]
    preload([liveRow])
    vi.doMock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
      useReadOnly: () => 'Mini gives this Machine read-only access',
    }))
    onTestFinished(() => void vi.doUnmock('../../src/renderer/projects/useProjects'))
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(LIST)
    const { default: SessionsSection } = await import('../../src/renderer/shell/sidebar/SessionsSection')
    const { useLayout } = await import('../../src/renderer/canvas/useLayout')
    const { useSessionFocus } = await import('../../src/renderer/claude-home/focus')
    function LayoutReady() {
      return useLayout(PROJECT_ID).state === undefined ? null : <span data-testid="layout-ready" />
    }
    render(
      <>
        <SessionsSection />
        <LayoutReady />
      </>,
    )
    await screen.findByTestId('layout-ready')
    const row = await screen.findByTestId('sidebar-session')
    expect(row.getAttribute('aria-disabled')).toBeNull()
    expect(row.getAttribute('title')).toContain(ROOT)
    await act(async () => {
      fireEvent.click(row)
      await waitFor(() => expect(useSessionFocus.getState().request).toMatchObject({ projectId: PROJECT_ID, nodeId: 'node-s' }))
    })
    expect(ops()).toEqual([])
  })

  it('a "go to" command of the palette restores it, then focuses it; ⌘Z archives it again', async () => {
    const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
    const { buildCommands } = await import('../../src/renderer/palette/commands')
    const { useCanvasRequests } = await import('../../src/renderer/find/canvas-requests')
    acceptLayoutState(state())
    const commands = buildCommands({
      project: LIST.projects[0],
      projects: LIST.projects,
      view: 'canvas',
      model: undefined,
      layoutNodes: main.nodes,
      history: [historyRow],
      adrs: [],
      tagFilter: null,
      createItems: [],
    })
    const command = commands.find((each) => each.id === 'node:node-s')
    expect(command).toBeDefined()
    command!.run()
    await waitFor(() => expect(useCanvasRequests.getState().focus).toMatchObject({ projectId: PROJECT_ID, nodeId: 'node-s' }))
    expect(ops()).toEqual([{ op: 'restore', ids: ['node-s'] }])
    await expectUndoArchives()
  })

  it('an archived Node that is hidden too comes back shown, as one step: one ⌘Z archives and hides it again', async () => {
    main.nodes = [sessionNode({ hidden: true })]
    const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
    const { showNode } = await import('../../src/renderer/canvas/show-node')
    acceptLayoutState(state())
    await expect(showNode(PROJECT_ID, main.nodes[0]!)).resolves.toBeUndefined()
    expect(ops()).toEqual([
      { op: 'restore', ids: ['node-s'] },
      { op: 'hide', id: 'node-s', hidden: false },
    ])
    await undo()
    expect(main.nodes[0]).toMatchObject({ hidden: true, archived: { batch: RECORD.batch } })
  })

  it('a hidden Node that is not archived is only shown, as a step: ⌘Z hides it again', async () => {
    main.nodes = [sessionNode({ hidden: true, archived: null })]
    const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
    const { showNode } = await import('../../src/renderer/canvas/show-node')
    acceptLayoutState(state())
    await expect(showNode(PROJECT_ID, main.nodes[0]!)).resolves.toBeUndefined()
    expect(ops()).toEqual([{ op: 'hide', id: 'node-s', hidden: false }])
    await undo()
    expect(ops().at(-1)).toEqual({ op: 'hide', id: 'node-s', hidden: true })
    expect(main.nodes[0]).toMatchObject({ hidden: true, archived: null })
  })

  it('showOps: restore only for an archived Node (a needless restore would count as the user\'s work with it), hide false only for a hidden one', async () => {
    const { showOps } = await import('../../src/renderer/canvas/show-node')
    expect(showOps({ id: 'n', hidden: true, archived: null })).toEqual([{ op: 'hide', id: 'n', hidden: false }])
    expect(showOps({ id: 'n', hidden: true })).toEqual([{ op: 'hide', id: 'n', hidden: false }])
    expect(showOps({ id: 'n', hidden: false, archived: RECORD })).toEqual([{ op: 'restore', ids: ['n'] }])
    expect(showOps({ id: 'n', hidden: true, archived: RECORD })).toEqual([
      { op: 'restore', ids: ['n'] },
      { op: 'hide', id: 'n', hidden: false },
    ])
    expect(showOps({ id: 'n', hidden: false, archived: null })).toEqual([])
  })

  it('a Node already on the Canvas is focused with nothing sent', async () => {
    main.nodes = [sessionNode({ archived: null })]
    const { showNode } = await import('../../src/renderer/canvas/show-node')
    await expect(showNode(PROJECT_ID, main.nodes[0]!)).resolves.toBeUndefined()
    expect(ops()).toEqual([])
  })
})

// Where the user is (worfy-polish ticket 44): in the Session view a row of the sidebar and "Resume"
// in the history show the Session there, its archived Node back first; on the Canvas they go to the Node.
describe('a Session opened from the sidebar or the history, where the user is', () => {
  async function renderSidebar(): Promise<void> {
    preload([liveRow])
    const projects = await import('../../src/renderer/projects/useProjects')
    projects.acceptProjectsState(LIST)
    const { default: SessionsSection } = await import('../../src/renderer/shell/sidebar/SessionsSection')
    const { useLayout } = await import('../../src/renderer/canvas/useLayout')
    function LayoutReady() {
      return useLayout(PROJECT_ID).state === undefined ? null : <span data-testid="layout-ready" />
    }
    render(
      <>
        <SessionsSection />
        <LayoutReady />
      </>,
    )
    await screen.findByTestId('layout-ready')
  }

  it('in the Session view a row of the sidebar restores its archived Node and shows its Session there, not the Canvas', async () => {
    const navigation = await import('../../src/renderer/session/navigation')
    const { useSessionFocus } = await import('../../src/renderer/claude-home/focus')
    navigation.setView('session')
    await renderSidebar()
    await act(async () => {
      fireEvent.click(await screen.findByTestId('sidebar-session'))
      // The Session main does not run now: read-only from its transcript, as a double click on its Node opens it.
      await waitFor(() => expect(navigation.useNavigation.getState().opened[PROJECT_ID]).toEqual({ nodeId: 'node-s', projectId: PROJECT_ID, external: { sessionId: SESSION } }))
    })
    expect(navigation.useNavigation.getState().view).toBe('session')
    expect(useSessionFocus.getState().request).toBeNull()
    expect(ops()).toEqual([{ op: 'restore', ids: ['node-s'] }, { op: 'touch', id: 'node-s' }])
    // Its Node is on the Canvas again, so the Session view shows it.
    expect(navigation.shownSession(navigation.useNavigation.getState().opened[PROJECT_ID], main.nodes, false)).toMatchObject({ nodeId: 'node-s' })
    await undo()
    expect(main.nodes[0]).toMatchObject({ archived: RECORD })
  })

  it('in the Session view a row of a Session worfy runs shows it live', async () => {
    main.nodes = [sessionNode({ archived: null })]
    const navigation = await import('../../src/renderer/session/navigation')
    const { acceptSessionNodeView } = await import('../../src/renderer/session/node-sessions')
    acceptSessionNodeView({ ...resumedView, state: 'idle' } as never)
    navigation.setView('session')
    await renderSidebar()
    fireEvent.click(await screen.findByTestId('sidebar-session'))
    await waitFor(() => expect(navigation.useNavigation.getState().opened[PROJECT_ID]).toEqual({ nodeId: 'node-s', projectId: PROJECT_ID }))
    expect(navigation.useNavigation.getState().view).toBe('session')
  })

  it('on the Canvas a row of the sidebar focuses the Node and opens nothing in the Session view', async () => {
    const navigation = await import('../../src/renderer/session/navigation')
    const { useSessionFocus } = await import('../../src/renderer/claude-home/focus')
    await renderSidebar()
    await act(async () => {
      fireEvent.click(await screen.findByTestId('sidebar-session'))
      await waitFor(() => expect(useSessionFocus.getState().request).toMatchObject({ projectId: PROJECT_ID, nodeId: 'node-s' }))
    })
    expect(navigation.useNavigation.getState()).toEqual({ view: 'canvas', opened: {}, withoutNode: {} })
  })

  async function resumeFromHistory(): Promise<void> {
    const { HistoryPopover } = await import('../../src/renderer/session/HistoryPopover')
    const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
    acceptLayoutState(state())
    render(<HistoryPopover project={LIST.projects[0]!} onClose={() => undefined} />)
    const row = await screen.findByTestId('history-session')
    const resume = within(row).getByTestId('history-resume')
    await waitFor(() => expect(resume).not.toHaveProperty('disabled', true))
    fireEvent.click(resume)
  }

  it('"Resume" in the history, in the Session view: its archived Node comes back and the resumed Session shows live there', async () => {
    const navigation = await import('../../src/renderer/session/navigation')
    const { useSessionFocus } = await import('../../src/renderer/claude-home/focus')
    navigation.setView('session')
    await resumeFromHistory()
    await waitFor(() => expect(navigation.useNavigation.getState().opened[PROJECT_ID]).toEqual({ nodeId: 'node-s', projectId: PROJECT_ID }))
    expect(navigation.useNavigation.getState().view).toBe('session')
    expect(useSessionFocus.getState().request).toBeNull()
    expect(ops()).toEqual([{ op: 'restore', ids: ['node-s'] }, { op: 'touch', id: 'node-s' }])
  })

  it('"Resume" in the history, on the Canvas: focuses the resumed Session\'s Node, as before', async () => {
    const navigation = await import('../../src/renderer/session/navigation')
    const { useSessionFocus } = await import('../../src/renderer/claude-home/focus')
    await resumeFromHistory()
    await waitFor(() => expect(useSessionFocus.getState().request).toMatchObject({ projectId: PROJECT_ID, nodeId: 'node-s' }))
    expect(navigation.useNavigation.getState()).toEqual({ view: 'canvas', opened: {}, withoutNode: {} })
  })
})
