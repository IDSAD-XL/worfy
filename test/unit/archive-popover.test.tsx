// The Archive popover next to Trash and the «N sessions» history of a Ticket
// (src/renderer/canvas/overlays/ArchivePopover.tsx, badges/SessionHistory.tsx; worfy-canvas ticket 09):
// the popover lists the archived Sessions without a Binding, searches them by title, restores one or
// all of today's through the Canvas's LayoutOps, and closes on Esc; a read-only screen sees the list
// with Restore inactive. IPC and the active Project are replaced; the Layout, Bindings and workflow
// stores are real.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import { DEFAULT_VIEWPORT } from '../../src/shared/layout/types'
import type { WorkflowModel } from '../../src/shared/workflow/types'
import { LayoutOpsContext, type LayoutOps } from '../../src/renderer/canvas/useLayout'

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

const NODES = [
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

const EMPTY_SIGNALS = { claim: null, cwd: null, gitBranch: null, skill: null, task: null }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  readOnly.hint = null
  ipc.invoke.mockImplementation((channel: string) => {
    switch (channel) {
      case 'layout.get':
        return Promise.resolve({ ok: true, value: { projectId: PROJECT, layout: { nodes: NODES, viewport: DEFAULT_VIEWPORT }, revision: 1 } })
      case 'claudeHome.sessions':
        return Promise.resolve({ ok: true, value: { live: [], history: [] } })
      case 'workflow.open':
        return Promise.resolve({ ok: true, value: MODEL })
      case 'bindings.get':
        return Promise.resolve({ ok: true, value: { projectId: PROJECT, bindings: [{ sessionId: 'b1', agentId: null, target: { kind: 'ticket', epic: 'demo', num: 1 } }] } })
      case 'bindings.signals':
        return Promise.resolve({ ok: true, value: { session: EMPTY_SIGNALS, subagents: [] } })
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

async function renderCanvas(ops: LayoutOps) {
  const { default: ArchivePopover } = await import('../../src/renderer/canvas/overlays/ArchivePopover')
  const { default: SessionHistory } = await import('../../src/renderer/canvas/badges/SessionHistory')
  const ticket = MODEL.tickets[0]!
  render(
    <div style={{ width: 800, height: 600 }}>
      <LayoutOpsContext.Provider value={ops}>
        <ReactFlowProvider>
          <ReactFlow nodes={[]} edges={[]}>
            <ArchivePopover />
            <SessionHistory subject={{ kind: 'ticket', projectId: PROJECT, root: ROOT, ticket }} />
          </ReactFlow>
        </ReactFlowProvider>
      </LayoutOpsContext.Provider>
    </div>,
  )
  return screen.findByTestId('archive-button')
}

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
    await waitFor(() => expect(sent).toEqual([{ op: 'restore', ids: ['session:a2'] }]))
  })

  it('«Restore all from today» restores the Sessions archived since midnight, as one operation', async () => {
    const { ops, sent } = recordingOps()
    fireEvent.click(await renderCanvas(ops))
    fireEvent.click(screen.getByRole('button', { name: 'Restore all from today' }))
    await waitFor(() => expect(sent).toEqual([{ op: 'restore', ids: ['session:a1', 'session:a2'] }]))
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
    await waitFor(() => expect(sent).toEqual([{ op: 'restore', ids: ['session:b1'] }]))
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
