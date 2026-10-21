// The Archive popover next to Trash and the «N sessions» history of a Ticket
// (src/renderer/canvas/overlays/ArchivePopover.tsx, badges/SessionHistory.tsx; worfy-canvas ticket 09):
// the popover lists the archived Sessions without a Binding, searches them by title, restores one or
// all of today's through the Canvas's LayoutOps, and closes on Esc; a read-only screen sees the list
// with Restore inactive. A Session whose Binding is not read yet is in neither list, and «Restore all
// from today» waits for it; the transcript of each archived Session is read once, however often the
// archived set changes. IPC and the active Project are replaced; the Layout, Bindings and workflow
// stores are real, fresh for each test.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSignals } from '../../src/shared/binding/resolve'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import { DEFAULT_VIEWPORT } from '../../src/shared/layout/types'
import type { WorkflowModel } from '../../src/shared/workflow/types'
import type { LayoutOps } from '../../src/renderer/canvas/useLayout'

const PROJECT = 'p1'
const ROOT = '/repo/one'
/** 15:00 local time: «today» began 15 hours ago. */
const NOW = new Date(2026, 9, 21, 15, 0).getTime()
const HOUR = 3_600_000

const readOnly = vi.hoisted(() => ({ hint: null as string | null }))

vi.mock('../../src/renderer/projects/useProjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()),
  useProjects: () => ({ activeId: 'p1', projects: [{ id: 'p1', name: 'one', path: '/repo/one', branch: 'main' }] }),
  useReadOnly: () => readOnly.hint,
}))

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/ipc')>()),
  invoke: ipc.invoke,
  subscribe: () => () => undefined,
}))

const sessionNode = (sessionId: string, name: string, at: number | null): LayoutNode => ({
  id: `session:${sessionId}`,
  kind: 'session',
  x: 0,
  y: 0,
  w: 300,
  h: 120,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data: { sessionId, origin: 'external', source: 'terminal', cwd: ROOT, name },
  archived: at === null ? null : { at, rule: 'idle', batch: `b${at}` },
})

const ALL_NODES = [
  sessionNode('a1', 'Refactor the parser', NOW - HOUR),
  sessionNode('a2', 'Write the docs', NOW - 2 * HOUR),
  sessionNode('a3', 'Old spike', NOW - 72 * HOUR),
  sessionNode('b1', 'Ship ticket one', NOW - 3 * HOUR),
  sessionNode('live', 'Still on the Canvas', null),
]

const MODEL: WorkflowModel = {
  root: ROOT,
  epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }],
  tickets: [
    {
      epic: 'demo',
      num: 1,
      slug: 'one',
      title: 'Ticket one',
      statusRaw: 'work',
      state: 'work',
      blockedRaw: null,
      blockedNums: [],
      blockedParsed: true,
      files: [],
      filesListed: true,
      fromBranch: null,
    },
  ],
  error: null,
  branchErrors: [],
}

const EMPTY_SIGNALS: AgentSignals = { claim: null, cwd: null, gitBranch: null, skill: null, task: null }

/** The Layout's Nodes `layout.get` answers with. */
let NODES: LayoutNode[] = ALL_NODES
/** The answers a test holds back: `bindings.get`, `workflow.open`, or `bindings.signals` of these Sessions. */
let holdManual: Promise<void> | undefined
let holdWorkflow: Promise<void> | undefined
let holdSignals: Map<string, Promise<void>>
/** The workflow model, the manual Bindings and the transcript signals main answers with. */
let WORKFLOW: WorkflowModel
let MANUAL: { sessionId: string; agentId: null; target: { kind: 'ticket'; epic: string; num: number } | { kind: 'epic'; epic: string } }[]
let SIGNALS: Map<string, AgentSignals>
/** `bindings.get` answers with an error; so does `bindings.signals` of these Sessions. */
let failManual: boolean
let failSignals: Set<string>
/** The Sessions `bindings.signals` was asked about, in order. */
let signalsAsked: string[]

const later = (): { promise: Promise<void>; release: () => void } => {
  let release = () => undefined as void
  const promise = new Promise<void>((done) => (release = done))
  return { promise, release }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  readOnly.hint = null
  NODES = ALL_NODES
  holdManual = undefined
  holdWorkflow = undefined
  holdSignals = new Map()
  WORKFLOW = MODEL
  MANUAL = [{ sessionId: 'b1', agentId: null, target: { kind: 'ticket', epic: 'demo', num: 1 } }]
  SIGNALS = new Map()
  failManual = false
  failSignals = new Set()
  signalsAsked = []
  ipc.invoke.mockImplementation((channel: string, input: unknown) => {
    switch (channel) {
      case 'layout.get':
        return Promise.resolve({ ok: true, value: { projectId: PROJECT, layout: { nodes: NODES, viewport: DEFAULT_VIEWPORT }, revision: 1 } })
      case 'claudeHome.sessions':
        return Promise.resolve({ ok: true, value: { live: [], history: [] } })
      case 'workflow.open':
        return (holdWorkflow ?? Promise.resolve()).then(() => ({ ok: true, value: WORKFLOW }))
      case 'bindings.get':
        return (holdManual ?? Promise.resolve()).then(() =>
          failManual ? { ok: false, error: 'the other machine did not answer in time' } : { ok: true, value: { projectId: PROJECT, bindings: MANUAL } },
        )
      case 'bindings.signals': {
        const { sessionId } = input as { sessionId: string }
        signalsAsked.push(sessionId)
        return (holdSignals.get(sessionId) ?? Promise.resolve()).then(() =>
          failSignals.has(sessionId) ? { ok: false, error: 'cannot read the transcript' } : { ok: true, value: { session: SIGNALS.get(sessionId) ?? EMPTY_SIGNALS, subagents: [] } },
        )
      }
      default:
        return Promise.resolve({ ok: true, value: undefined })
    }
  })
  const globals = globalThis as { ResizeObserver?: unknown }
  globals.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

afterEach(() => {
  vi.useRealTimers()
  ipc.invoke.mockReset()
})

/** LayoutOps that record every operation. */
function recordingOps(): { ops: LayoutOps; sent: LayoutOpInput[] } {
  const sent: LayoutOpInput[] = []
  return { sent, ops: { apply: (op) => (sent.push(op), Promise.resolve()) } }
}

/** Main's broadcast of a new Layout: these Nodes, a revision later. */
async function layoutChanged(nodes: LayoutNode[], revision: number): Promise<void> {
  const { acceptLayoutState } = await import('../../src/renderer/canvas/useLayout')
  act(() => acceptLayoutState({ projectId: PROJECT, layout: { nodes, viewport: DEFAULT_VIEWPORT }, revision }))
}

/** The Canvas with the Archive and the history badges of Tickets 01 and 02; resolves once it is drawn. */
async function mountCanvas(ops: LayoutOps): Promise<void> {
  const { default: ArchivePopover } = await import('../../src/renderer/canvas/overlays/ArchivePopover')
  const { default: SessionHistory } = await import('../../src/renderer/canvas/badges/SessionHistory')
  const { LayoutOpsContext } = await import('../../src/renderer/canvas/useLayout')
  const ticket = MODEL.tickets[0]!
  const second = { ...ticket, num: 2, slug: 'two', title: 'Ticket two' }
  render(
    <div style={{ width: 800, height: 600 }}>
      <LayoutOpsContext.Provider value={ops}>
        <ReactFlowProvider>
          <ReactFlow nodes={[]} edges={[]}>
            <ArchivePopover />
            <SessionHistory subject={{ kind: 'ticket', projectId: PROJECT, root: ROOT, ticket }} />
            <SessionHistory subject={{ kind: 'ticket', projectId: PROJECT, root: ROOT, ticket: second }} />
          </ReactFlow>
        </ReactFlowProvider>
      </LayoutOpsContext.Provider>
    </div>,
  )
  await act(() => Promise.resolve())
}

async function renderCanvas(ops: LayoutOps) {
  await mountCanvas(ops)
  return screen.findByTestId('archive-button')
}

/** What Restore sends for these shown Nodes: a restore of each; its undo is the shared inverse (history.ts). */
const restoreOf = (...nodeIds: string[]): LayoutOpInput[] => nodeIds.map((id) => ({ op: 'restore', ids: [id] }))

const rowTitles = (dialog: HTMLElement) => within(dialog).getAllByTestId('archive-row').map((row) => row.querySelector('.w-archive__title')!.textContent)

describe('the Archive popover', () => {
  it('lists the archived Sessions without a Binding, newest first; the bound one is in its Ticket\'s history', async () => {
    const button = await renderCanvas(recordingOps().ops)
    expect(button.textContent).toBe('Archive3')
    expect(button.getAttribute('aria-label')).toBe('Archive: 3 archived Sessions without a Binding')
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: 'Archive' })
    expect(rowTitles(dialog)).toEqual(['Refactor the parser', 'Write the docs', 'Old spike'])
    // b1 has a manual Binding to demo/1.
    await waitFor(() => expect(screen.getByTestId('ticket-sessions-button').textContent).toBe('1 session'))
  })

  it('searches by title', async () => {
    fireEvent.click(await renderCanvas(recordingOps().ops))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the archive by title' }), { target: { value: 'PARSER' } })
    expect(rowTitles(screen.getByRole('dialog', { name: 'Archive' }))).toEqual(['Refactor the parser'])
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing like it' } })
    expect(screen.getByText('No Session matches')).toBeTruthy()
  })

  it('Restore sends one restore of that Node through LayoutOps', async () => {
    const { ops, sent } = recordingOps()
    fireEvent.click(await renderCanvas(ops))
    fireEvent.click(screen.getByRole('button', { name: 'Restore Write the docs' }))
    await waitFor(() => expect(sent).toEqual(restoreOf('session:a2')))
  })

  it('«Restore all from today» restores the Sessions archived since midnight, as one operation', async () => {
    const { ops, sent } = recordingOps()
    fireEvent.click(await renderCanvas(ops))
    fireEvent.click(screen.getByRole('button', { name: 'Restore all from today' }))
    await waitFor(() => expect(sent).toEqual(restoreOf('session:a1', 'session:a2')))
  })

  it('Esc closes it, and that press does nothing else', async () => {
    fireEvent.click(await renderCanvas(recordingOps().ops))
    expect(screen.getByRole('dialog', { name: 'Archive' })).toBeTruthy()
    const press = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      window.dispatchEvent(press)
    })
    expect(press.defaultPrevented).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Archive' })).toBeNull()
  })

  it('on a read-only screen the list is shown and Restore is inactive', async () => {
    readOnly.hint = 'Studio gives this Machine read-only access'
    const { ops, sent } = recordingOps()
    fireEvent.click(await renderCanvas(ops))
    const dialog = screen.getByRole('dialog', { name: 'Archive' })
    expect(rowTitles(dialog)).toHaveLength(3)
    const restore = screen.getByRole('button', { name: 'Restore Refactor the parser' })
    const all = screen.getByRole('button', { name: 'Restore all from today' })
    expect(restore.getAttribute('aria-disabled')).toBe('true')
    expect(restore.getAttribute('title')).toBe('Studio gives this Machine read-only access')
    expect(all.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(restore)
    fireEvent.click(all)
    await act(() => Promise.resolve())
    expect(sent).toEqual([])
  })
})

describe("a Ticket's history", () => {
  it('lists its archived Sessions; Show restores the Node through LayoutOps; Esc closes it', async () => {
    const { ops, sent } = recordingOps()
    await renderCanvas(ops)
    const badge = await screen.findByRole('button', { name: '1 session archived of ticket demo/01' })
    expect(badge.tagName).toBe('BUTTON')
    fireEvent.click(badge)
    const dialog = screen.getByRole('dialog', { name: 'Archived sessions of demo/01' })
    expect(rowTitles(dialog)).toEqual(['Ship ticket one'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show Ship ticket one' }))
    // No Epic frames drawn here: Show is a plain Restore, at the old place or the nearest clear one.
    await waitFor(() => expect(sent).toEqual(restoreOf('session:b1')))
    expect(screen.queryByRole('dialog', { name: 'Archived sessions of demo/01' })).toBeNull()
    fireEvent.click(badge)
    expect(screen.getByRole('dialog', { name: 'Archived sessions of demo/01' })).toBeTruthy()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(screen.queryByRole('dialog', { name: 'Archived sessions of demo/01' })).toBeNull()
  })

  it('on a read-only screen Show is inactive', async () => {
    readOnly.hint = 'Studio gives this Machine read-only access'
    const { ops, sent } = recordingOps()
    await renderCanvas(ops)
    fireEvent.click(await screen.findByRole('button', { name: '1 session archived of ticket demo/01' }))
    const show = screen.getByRole('button', { name: 'Show Ship ticket one' })
    expect(show.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(show)
    await act(() => Promise.resolve())
    expect(sent).toEqual([])
  })
})

describe('until the Bindings are read', () => {
  it('no Session counts as without a Binding before the manual Bindings arrive', async () => {
    const manual = later()
    holdManual = manual.promise
    await mountCanvas(recordingOps().ops)
    await waitFor(() => expect(signalsAsked).toHaveLength(4))
    await act(() => Promise.resolve())
    // b1 is bound by hand: before `bindings.get` answers it would look unbound and be listed here.
    expect(screen.queryByTestId('archive-button')).toBeNull()
    manual.release()
    expect((await screen.findByTestId('archive-button')).textContent).toBe('Archive3')
  })

  it('a Session whose transcript is not read yet is listed nowhere, and «Restore all from today» waits for it', async () => {
    const a2 = later()
    holdSignals.set('a2', a2.promise)
    const { ops, sent } = recordingOps()
    const button = await renderCanvas(ops)
    await waitFor(() => expect(button.textContent).toBe('Archive2'))
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: 'Archive' })
    expect(rowTitles(dialog)).toEqual(['Refactor the parser', 'Old spike'])
    expect(screen.getByTestId('archive-pending').textContent).toBe('Reading the Bindings of 1 more Session…')
    const all = screen.getByRole('button', { name: 'Restore all from today' })
    expect(all.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(all)
    await act(() => Promise.resolve())
    expect(sent).toEqual([])
    a2.release()
    await waitFor(() => expect(rowTitles(dialog)).toEqual(['Refactor the parser', 'Write the docs', 'Old spike']))
    expect(all.getAttribute('aria-disabled')).toBeNull()
  })

  it('a Session bound only by its branch stays pending until the workflow model is read', async () => {
    const workflow = later()
    holdWorkflow = workflow.promise
    WORKFLOW = { ...MODEL, tickets: MODEL.tickets.map((ticket) => ({ ...ticket, branch: 'change-the-parser' })) }
    SIGNALS.set('a1', { ...EMPTY_SIGNALS, gitBranch: 'change-the-parser' })
    await mountCanvas(recordingOps().ops)
    await waitFor(() => expect([...signalsAsked].sort()).toEqual(['a1', 'a2', 'a3', 'b1']))
    await act(() => Promise.resolve())
    // Without the model the branch names no Ticket: a1 would look unbound and be listed in the Archive.
    // Until the model is read no Session counts as without a Binding.
    expect(screen.queryByTestId('archive-button')).toBeNull()
    workflow.release()
    const button = await screen.findByTestId('archive-button')
    expect(button.textContent).toBe('Archive2')
    await waitFor(() => expect(screen.getByTestId('ticket-sessions-button').textContent).toBe('2 sessions'))
    fireEvent.click(button)
    expect(rowTitles(screen.getByRole('dialog', { name: 'Archive' }))).toEqual(['Write the docs', 'Old spike'])
  })

  it('a failed read of the manual Bindings counts as read: the Sessions are listed, not pending for good', async () => {
    failManual = true
    const button = await renderCanvas(recordingOps().ops)
    // b1's manual Binding is unknown: it is listed without one.
    await waitFor(() => expect(button.textContent).toBe('Archive4'))
    fireEvent.click(button)
    expect(rowTitles(screen.getByRole('dialog', { name: 'Archive' }))).toEqual(['Refactor the parser', 'Write the docs', 'Ship ticket one', 'Old spike'])
    expect(screen.queryByTestId('archive-pending')).toBeNull()
  })

  it('a failed transcript read counts as read, and is asked again when the archived set changes', async () => {
    failSignals.add('a2')
    const button = await renderCanvas(recordingOps().ops)
    await waitFor(() => expect(button.textContent).toBe('Archive3'))
    expect(signalsAsked.filter((id) => id === 'a2')).toHaveLength(1)
    await layoutChanged([...ALL_NODES, sessionNode('c1', 'New one', NOW - 1000)], 2)
    await waitFor(() => expect(signalsAsked.filter((id) => id === 'a2')).toHaveLength(2))
    // A read that worked is not asked again.
    expect(signalsAsked.filter((id) => id === 'a1')).toHaveLength(1)
  })

  it('reads the transcript of each archived Session once, however often the archived set changes', async () => {
    await renderCanvas(recordingOps().ops)
    await waitFor(() => expect([...signalsAsked].sort()).toEqual(['a1', 'a2', 'a3', 'b1']))
    // a2 is restored, then archived again, and a new Session is archived.
    const restored = ALL_NODES.map((node) => (node.id === 'session:a2' ? { ...node, archived: null } : node))
    await layoutChanged(restored, 2)
    await layoutChanged([...ALL_NODES, sessionNode('c1', 'New one', NOW - 1000)], 3)
    await waitFor(() => expect(screen.getByTestId('archive-button').textContent).toBe('Archive4'))
    expect([...signalsAsked].sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'c1'])
  })
})

describe('nothing to show', () => {
  it('no «Archive» button while no archived Session is without a Binding', async () => {
    NODES = ALL_NODES.filter((node) => node.id === 'session:b1' || node.id === 'session:live')
    await mountCanvas(recordingOps().ops)
    await screen.findByRole('button', { name: '1 session archived of ticket demo/01' })
    expect(screen.queryByTestId('archive-button')).toBeNull()
  })

  it('the Archive popover closes, and its button goes, when its list empties', async () => {
    fireEvent.click(await renderCanvas(recordingOps().ops))
    expect(screen.getByRole('dialog', { name: 'Archive' })).toBeTruthy()
    // a1, a2 and a3 come back on the Canvas (another screen restored them).
    const unbound = new Set(['session:a1', 'session:a2', 'session:a3'])
    await layoutChanged(ALL_NODES.map((node) => (unbound.has(node.id) ? { ...node, archived: null } : node)), 2)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Archive' })).toBeNull())
    expect(screen.queryByTestId('archive-button')).toBeNull()
  })

  it('no «N sessions» on a Ticket without archived Sessions; the history closes when its list empties and stays closed', async () => {
    await renderCanvas(recordingOps().ops)
    const badge = await screen.findByRole('button', { name: '1 session archived of ticket demo/01' })
    expect(screen.getAllByTestId('ticket-sessions-button')).toHaveLength(1)
    fireEvent.click(badge)
    expect(screen.getByRole('dialog', { name: 'Archived sessions of demo/01' })).toBeTruthy()
    // b1 comes back on the Canvas (another screen showed it): the list is empty.
    await layoutChanged(ALL_NODES.map((node) => (node.id === 'session:b1' ? { ...node, archived: null } : node)), 2)
    await waitFor(() => expect(screen.queryByTestId('ticket-sessions-button')).toBeNull())
    expect(screen.queryByRole('dialog', { name: 'Archived sessions of demo/01' })).toBeNull()
    // Archived again: the badge is back, its history closed until clicked.
    await layoutChanged(ALL_NODES, 3)
    await screen.findByRole('button', { name: '1 session archived of ticket demo/01' })
    expect(screen.queryByRole('dialog', { name: 'Archived sessions of demo/01' })).toBeNull()
  })
})

describe("an Epic's history", () => {
  it("lists the Epic's own archived Sessions and its Tickets'; Show of one bound to the Epic restores it through LayoutOps", async () => {
    MANUAL = [...MANUAL, { sessionId: 'a3', agentId: null, target: { kind: 'epic', epic: 'demo' } }]
    const { ops, sent } = recordingOps()
    await renderCanvas(ops)
    const { default: EpicSessionHistory } = await import('../../src/renderer/canvas/actions/EpicSessionHistory')
    const { LayoutOpsContext } = await import('../../src/renderer/canvas/useLayout')
    render(
      <LayoutOpsContext.Provider value={ops}>
        <EpicSessionHistory subject={{ kind: 'epic', projectId: PROJECT, root: ROOT, epic: MODEL.epics[0]!, tickets: MODEL.tickets }} />
      </LayoutOpsContext.Provider>,
    )
    const button = await screen.findByRole('button', { name: '2 sessions archived of epic demo' })
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: 'Archived sessions of demo' })
    // The Epic's own (a3) and demo/01's (b1), newest first.
    expect(rowTitles(dialog)).toEqual(['Ship ticket one', 'Old spike'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show Old spike' }))
    // No frame drawn here: Show is a plain Restore.
    await waitFor(() => expect(sent).toEqual(restoreOf('session:a3')))
  })
})
