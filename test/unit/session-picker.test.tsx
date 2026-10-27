// The Session view's choice of Session (worfy-polish ticket 44): the picker in its header lists the
// Project's Sessions — the Orchestrator first, then the running ones, then the other open ones, each
// with its title and status — and a pick shows that Session at once; the view remembers the last
// Session of each Project and shows the Orchestrator once that Session's Node is closed, archived or
// hidden (session/navigation.ts). Rendered against a fake bridge: no main process, no ~/.claude.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'
import type { LayoutNode, LayoutState } from '../../src/shared/layout/types'

const A = 'alpha-0000000a'
const B = 'beta-0000000b'
const ROOT_A = '/repo/alpha'
const ROOT_B = '/repo/beta'
const PROJECTS = {
  projects: [
    { id: A, name: 'alpha', path: ROOT_A, branch: 'main' },
    { id: B, name: 'beta', path: ROOT_B, branch: 'main' },
  ],
  activeId: A,
  revision: 1,
}

const S_DONE = '11111111-1111-4111-8111-111111111111'
const S_TERM = '22222222-2222-4222-8222-222222222222'
const S_RUN = '33333333-3333-4333-8333-333333333333'
const S_IDLE = '44444444-4444-4444-8444-444444444444'
const S_HIDDEN = '55555555-5555-4555-8555-555555555555'

const node = (id: string, kind: string, data: Record<string, unknown>, over: Partial<LayoutNode> = {}): LayoutNode => ({
  id,
  kind,
  x: 0,
  y: 0,
  w: 300,
  h: 120,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data,
  ...over,
})

/**
 * Project A's Canvas, in Layout order: a finished worfy Session, a terminal Session that runs, the
 * Orchestrator, a worfy Session that runs, a terminal Session that has ended, and two Session
 * Nodes not on the Canvas — one hidden, one archived.
 */
const nodesA = (): LayoutNode[] => [
  node('node-done', 'session', { origin: 'worfy', sessionId: S_DONE }),
  node(`session:${S_TERM}`, 'session', { sessionId: S_TERM, origin: 'external', source: 'terminal', cwd: ROOT_A, name: 'from the terminal' }),
  node('orch-a', 'orchestrator', {}),
  node('node-run', 'session', { origin: 'worfy', sessionId: S_RUN }),
  node(`session:${S_IDLE}`, 'session', { sessionId: S_IDLE, origin: 'external', source: 'desktop', cwd: ROOT_A }),
  node(`session:${S_HIDDEN}`, 'session', { sessionId: S_HIDDEN, origin: 'external', source: 'terminal', cwd: ROOT_A }, { hidden: true }),
  node('node-archived', 'session', { origin: 'worfy', sessionId: S_HIDDEN }, { archived: { at: 1, rule: 'idle', batch: 'b1' } }),
]

const LIVE_A: LiveSession[] = [{ pid: 7, sessionId: S_TERM, cwd: ROOT_A, status: 'busy', entrypoint: 'cli' }]
const HISTORY_A = [
  { sessionId: S_DONE, title: 'Wave 2 review', size: 1, modifiedAt: 1, live: false },
  { sessionId: S_IDLE, title: 'Desktop notes', size: 1, modifiedAt: 1, live: false },
]
const RUN_VIEW: SessionNodeView = { projectId: A, nodeId: 'node-run', sessionId: 'pending-9', sdkSessionId: S_RUN, state: 'busy', error: null, cwd: ROOT_A, model: null, version: 1 }

const orchestratorView = (projectId: string, nodeId: string) => ({ projectId, nodeId, sessionId: null, state: 'idle', error: null, model: null, costUsd: 0, statusBlock: null, version: 1 })

let layouts: Record<string, LayoutNode[]>
let answers: Record<string, (input: unknown) => unknown>
/** The channels the renderer called, in order. */
const sent: string[] = []

const layoutState = (projectId: string, revision = 1): LayoutState => ({ projectId, layout: { nodes: layouts[projectId] ?? [], viewport: { x: 0, y: 0, zoom: 1 } }, revision })
const rootOf = (input: unknown): string => (input as { projectRoot: string }).projectRoot

beforeEach(() => {
  vi.resetModules()
  sent.length = 0
  layouts = { [A]: nodesA(), [B]: [node('orch-b', 'orchestrator', {}), node('node-b', 'session', { origin: 'worfy', sessionId: S_DONE })] }
  answers = {
    'projects.list': () => PROJECTS,
    'linked.state': () => ({ machines: [] }),
    'claudeHome.sessions': (input) => (rootOf(input) === ROOT_A ? { live: LIVE_A, history: HISTORY_A } : { live: [], history: [] }),
    'claudeHome.live': (input) => ({ live: rootOf(input) === ROOT_A ? LIVE_A : [] }),
    'claudeHome.close': () => ({ closed: true }),
    'claudeHome.transcript': () => ({ found: true, events: [], reset: false, more: false, cursor: { offset: 0, fileId: null } }),
    'claudeHome.subagents': () => ({ found: true, signals: [], files: [] }),
    'layout.get': (input) => layoutState((input as { projectId: string }).projectId),
    'layout.apply': (input) => layoutState((input as { projectId: string }).projectId),
    'sessions.views': (input) => ({ views: (input as { projectId: string }).projectId === A ? [RUN_VIEW] : [] }),
    'orchestrator.open': (input) => {
      const { projectId } = input as { projectId: string }
      return orchestratorView(projectId, projectId === A ? 'orch-a' : 'orch-b')
    },
    'orchestrator.view': (input) => {
      const { nodeId } = input as { nodeId: string }
      return { view: nodeId === 'orch-a' ? orchestratorView(A, nodeId) : nodeId === 'orch-b' ? orchestratorView(B, nodeId) : null }
    },
  }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      sent.push(channel)
      const answer = answers[channel]
      return Promise.resolve(answer ? { ok: true, value: answer(input) } : { ok: false, error: `no ${channel}` })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Lets the fake bridge's answers land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0))
  })
}

async function renderView(projectId = A) {
  const projects = await import('../../src/renderer/projects/useProjects')
  projects.acceptProjectsState(PROJECTS)
  const navigation = await import('../../src/renderer/session/navigation')
  const { SessionView } = await import('../../src/renderer/session/SessionView')
  const view = render(<SessionView projectId={projectId} projectName={projectId === A ? 'alpha' : 'beta'} />)
  await settle()
  const rerender = async (next: string) => {
    view.rerender(<SessionView projectId={next} projectName={next === A ? 'alpha' : 'beta'} />)
    await settle()
  }
  return { navigation, rerender }
}

const shownNode = (): string | undefined => screen.getByTestId('session-view').dataset['nodeId']

/** The rows of the open picker: label, detail (the status), value and whether it can be picked. */
function pickerRows(): { label: string; detail: string; value: string; disabled: boolean }[] {
  return within(screen.getByTestId('session-picker-list'))
    .getAllByRole('option')
    .map((option) => ({
      label: option.querySelector('.w-select-option__label')?.textContent ?? '',
      detail: option.querySelector('.w-select-option__detail')?.textContent ?? '',
      value: option.dataset['value'] ?? '',
      disabled: option.getAttribute('aria-disabled') === 'true',
    }))
}

/** Opens the picker (a click on a closed one) and waits until it lists `count` rows. */
async function openPicker(count: number): Promise<void> {
  const picker = screen.getByTestId('session-picker')
  if (picker.getAttribute('aria-expanded') !== 'true') fireEvent.click(picker)
  await waitFor(() => expect(pickerRows()).toHaveLength(count))
}

describe('the Session picker (Q1)', () => {
  it('pickerSessions: the Orchestrator first, then the running Sessions, then the other open ones, in Layout order; none off the Canvas', async () => {
    const { pickerSessions } = await import('../../src/renderer/session/session-picker')
    const rows = pickerSessions({ projectId: A, nodes: nodesA(), orchestrators: {}, sessionNodes: { 'node-run': RUN_VIEW }, live: LIVE_A, history: HISTORY_A })
    expect(rows.map((row) => [row.nodeId, row.title, row.chip.label, row.running])).toEqual([
      ['orch-a', 'Orchestrator', 'starting', true],
      [`session:${S_TERM}`, 'from the terminal', 'busy', true],
      ['node-run', `Session ${S_RUN.slice(0, 8)}`, 'busy', true],
      ['node-done', 'Wave 2 review', 'finished', false],
      [`session:${S_IDLE}`, 'Desktop notes', 'finished', false],
    ])
    // Each opens as a double click on its Node does.
    expect(rows.map((row) => row.opens)).toEqual([
      { nodeId: 'orch-a', projectId: A },
      { nodeId: `session:${S_TERM}`, projectId: A, external: { sessionId: S_TERM } },
      { nodeId: 'node-run', projectId: A },
      { nodeId: 'node-done', projectId: A, external: { sessionId: S_DONE } },
      { nodeId: `session:${S_IDLE}`, projectId: A, external: { sessionId: S_IDLE } },
    ])
  })

  it('a worfy Session that runs again only in the registry counts as running; a Session Node that never had a Session is not listed', async () => {
    const { pickerSessions } = await import('../../src/renderer/session/session-picker')
    const nodes = [node('orch-a', 'orchestrator', {}), node('node-done', 'session', { origin: 'worfy', sessionId: S_DONE }), node('node-new', 'session', { origin: 'worfy' })]
    const live: LiveSession[] = [{ pid: 9, sessionId: S_DONE, cwd: ROOT_A, status: 'idle' }]
    const rows = pickerSessions({ projectId: A, nodes, orchestrators: {}, sessionNodes: {}, live, history: [] })
    expect(rows.map((row) => [row.nodeId, row.running])).toEqual([
      ['orch-a', true],
      ['node-done', true],
    ])
  })

  it('lists the Sessions of this Project only, with title and status, and the shown one chosen', async () => {
    await renderView(A)
    await openPicker(5)
    // The registry and the history are read after the Layout: the rows follow them while the list is open.
    await waitFor(() => expect(pickerRows().map((row) => row.label)).toEqual(['Orchestrator', 'from the terminal', `Session ${S_RUN.slice(0, 8)}`, 'Wave 2 review', 'Desktop notes']))
    const rows = pickerRows()
    expect(rows.map((row) => row.detail)).toEqual(['idle', 'busy', 'busy', 'finished', 'finished'])
    expect(screen.getByTestId('session-picker').dataset['value']).toBe('orch-a')
    // Project B's Session «node-b» is not in A's list.
    expect(rows.map((row) => row.value)).not.toContain('node-b')
  })

  it('a pick shows that Session at once: a running worfy Session live, a Session worfy does not run read-only', async () => {
    const { navigation } = await renderView(A)
    expect(shownNode()).toBe('orch-a')
    await openPicker(5)
    fireEvent.click(screen.getByRole('option', { name: /Session 33333333/ }))
    await settle()
    expect(shownNode()).toBe('node-run')
    expect(screen.getByTestId('session-view').dataset['readOnly']).toBeUndefined()
    expect(navigation.useNavigation.getState().opened[A]).toEqual({ nodeId: 'node-run', projectId: A })

    await openPicker(5)
    fireEvent.click(screen.getByRole('option', { name: /from the terminal/ }))
    await settle()
    expect(shownNode()).toBe(`session:${S_TERM}`)
    expect(screen.getByTestId('session-view').dataset['readOnly']).toBe('true')
    expect(screen.getByTestId('session-picker').dataset['value']).toBe(`session:${S_TERM}`)

    // The Orchestrator is a row too.
    await openPicker(5)
    fireEvent.click(screen.getByRole('option', { name: /Orchestrator/ }))
    await settle()
    expect(shownNode()).toBe('orch-a')
  })

  it('the keyboard opens the list, moves and picks, as in every Select of the app', async () => {
    await renderView(A)
    const picker = screen.getByTestId('session-picker')
    expect(picker.getAttribute('role')).toBe('combobox')
    expect(picker.getAttribute('aria-label')).toBe('Session')
    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    await waitFor(() => expect(pickerRows()[1]?.label).toBe('from the terminal'))
    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    fireEvent.keyDown(picker, { key: 'Enter' })
    await settle()
    expect(shownNode()).toBe(`session:${S_TERM}`)
  })

  it('a pick marks the Node as used (touch); on a read-only screen it switches the Session and writes nothing', async () => {
    await renderView(A)
    await openPicker(5)
    fireEvent.click(screen.getByRole('option', { name: /Session 33333333/ }))
    await settle()
    expect(sent.filter((channel) => channel === 'layout.apply')).toHaveLength(1)
    // A screen of a Linked machine that shares its Projects read-only (worfy-link ticket 25).
    const { answerReadOnly } = await import('../../src/renderer/projects/read-only-now')
    answerReadOnly(() => 'Mini gives this Machine read-only access')
    await openPicker(5)
    fireEvent.click(screen.getByRole('option', { name: /from the terminal/ }))
    await settle()
    expect(shownNode()).toBe(`session:${S_TERM}`)
    expect(sent.filter((channel) => channel === 'layout.apply')).toHaveLength(1)
  })

  it('a Session shown without a Node of the list (a Subagent window) stands at the top and cannot be picked', async () => {
    const { navigation } = await renderView(A)
    act(() => navigation.openSession({ nodeId: 'node-run', projectId: A, external: { sessionId: S_RUN, agentId: 'a1' } }))
    await settle()
    await openPicker(6)
    expect(pickerRows()[0]).toMatchObject({ value: 'agent:node-run/a1', detail: 'shown', disabled: true })
  })
})

describe('the last Session of each Project (Q3)', () => {
  it('a Session opened in Project A is not shown in Project B, and back in A the view is on it again', async () => {
    const { navigation, rerender } = await renderView(A)
    act(() => navigation.openSession({ nodeId: 'node-run', projectId: A }))
    await settle()
    expect(shownNode()).toBe('node-run')
    await rerender(B)
    expect(shownNode()).toBe('orch-b')
    act(() => navigation.openSession({ nodeId: 'node-b', projectId: B, external: { sessionId: S_DONE } }))
    await settle()
    expect(shownNode()).toBe('node-b')
    await rerender(A)
    expect(shownNode()).toBe('node-run')
    await rerender(B)
    expect(shownNode()).toBe('node-b')
  })

  it('a click on the Session tab and "Switch to Session" show the last Session of the Project', async () => {
    const { navigation } = await renderView(A)
    const { buildCommands } = await import('../../src/renderer/palette/commands')
    act(() => navigation.openSession({ nodeId: 'node-run', projectId: A }))
    act(() => navigation.setView('canvas'))
    act(() => navigation.setView('session'))
    await settle()
    expect(shownNode()).toBe('node-run')
    act(() => navigation.setView('canvas'))
    const project = PROJECTS.projects[0]!
    const command = buildCommands({ project, projects: PROJECTS.projects, view: 'canvas', model: undefined, layoutNodes: nodesA(), history: [], adrs: [], tagFilter: null, createItems: [] }).find(
      (each) => each.id === 'view:session',
    )
    act(() => void command!.run())
    await settle()
    expect(navigation.useNavigation.getState().view).toBe('session')
    expect(shownNode()).toBe('node-run')
  })

  it.each([
    ['closed', (nodes: LayoutNode[]) => nodes.filter((each) => each.id !== 'node-run')],
    ['archived', (nodes: LayoutNode[]) => nodes.map((each) => (each.id === 'node-run' ? { ...each, archived: { at: 2, rule: 'idle' as const, batch: 'b2' } } : each))],
    ['hidden', (nodes: LayoutNode[]) => nodes.map((each) => (each.id === 'node-run' ? { ...each, hidden: true } : each))],
  ])('a last Session whose Node is %s since gives way to the Orchestrator', async (_, change) => {
    const { navigation } = await renderView(A)
    const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
    act(() => navigation.openSession({ nodeId: 'node-run', projectId: A }))
    await settle()
    expect(shownNode()).toBe('node-run')
    layouts[A] = change(nodesA())
    act(() => acceptLayoutState(layoutState(A, 2)))
    await settle()
    expect(shownNode()).toBe('orch-a')
  })

  it('"Go to Orchestrator" forgets the Project\'s last Session, and only that Project\'s', async () => {
    const { navigation } = await renderView(A)
    act(() => {
      navigation.openSession({ nodeId: 'node-run', projectId: A })
      navigation.openSession({ nodeId: 'node-b', projectId: B, external: { sessionId: S_DONE } })
    })
    await act(async () => {
      await navigation.openOrchestrator(A)
    })
    expect(shownNode()).toBe('orch-a')
    expect(navigation.useNavigation.getState().opened).toEqual({ [B]: { nodeId: 'node-b', projectId: B, external: { sessionId: S_DONE } } })
    act(() => navigation.setView('canvas'))
    act(() => navigation.setView('session'))
    await settle()
    expect(shownNode()).toBe('orch-a')
  })

  it('a transcript opened without a Node (the palette) shows until it gets a Node; once that Node is closed, the Orchestrator', async () => {
    const { navigation } = await renderView(A)
    const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
    const S_NEW = '66666666-6666-4666-8666-666666666666'
    act(() => navigation.openSession({ nodeId: `session:${S_NEW}`, projectId: A, external: { sessionId: S_NEW } }))
    await settle()
    expect(shownNode()).toBe(`session:${S_NEW}`)
    expect(navigation.useNavigation.getState().withoutNode).toEqual({ [A]: true })
    // «Show» in the history gives it a Node: the memory now follows that Node.
    layouts[A] = [...nodesA(), node(`session:${S_NEW}`, 'session', { sessionId: S_NEW, origin: 'external', source: 'terminal', cwd: ROOT_A })]
    act(() => acceptLayoutState(layoutState(A, 2)))
    await settle()
    expect(navigation.useNavigation.getState().withoutNode).toEqual({})
    expect(shownNode()).toBe(`session:${S_NEW}`)
    layouts[A] = nodesA()
    act(() => acceptLayoutState(layoutState(A, 3)))
    await settle()
    expect(shownNode()).toBe('orch-a')
  })

  it('shownSession: the record while its Node is on the Canvas; the Orchestrator (null) when its Node is gone, archived or hidden; the record before the Layout came', async () => {
    const { shownSession } = await import('../../src/renderer/session/navigation')
    const opened = { nodeId: 'node-run', projectId: A }
    const nodes = nodesA()
    expect(shownSession(undefined, nodes, false)).toBeNull()
    expect(shownSession(opened, nodes, false)).toBe(opened)
    expect(shownSession(opened, undefined, false)).toBe(opened)
    expect(shownSession(opened, [], false)).toBeNull()
    expect(shownSession(opened, [], true)).toBe(opened)
    expect(shownSession({ nodeId: `session:${S_HIDDEN}`, projectId: A }, nodes, false)).toBeNull()
    expect(shownSession({ nodeId: 'node-archived', projectId: A }, nodes, true)).toBeNull()
    // A Subagent's window is judged by the Node it was opened on.
    expect(shownSession({ nodeId: 'node-run', projectId: A, external: { sessionId: S_RUN, agentId: 'a1' } }, nodes, false)).toMatchObject({ nodeId: 'node-run' })
    expect(shownSession({ nodeId: 'node-archived', projectId: A, external: { sessionId: S_HIDDEN, agentId: 'a1' } }, nodes, false)).toBeNull()
  })
})
