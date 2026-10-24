// The focused Ticket: a Ticket Node in a tile of focus mode shows its whole file as markdown under
// its header, reads it again when the workflow model brings a new version of the Ticket, resolves
// the file's relative links against its folder, and opens the file in the editor at the path main
// found; on a Linked machine that button shows where the file is. The card on the Canvas reads
// nothing and asks for focus mode on a double click, which the way in (FocusEntry) opens.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ticketsRead } from '../../src/shared/ipc/tickets'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import TicketNode from '../../src/renderer/canvas/nodes/TicketNode'
import { folderOf } from '../../src/renderer/canvas/nodes/ticket-text'
import type { CanvasFlowNode, CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import FocusEntry from '../../src/renderer/canvas/overlays/FocusEntry'
import { buildEpicNodes, ticketNodeId } from '../../src/renderer/canvas/sources/epics'
import { requestFocus, useFocusState } from '../../src/renderer/focus/focus-state'
import { FocusTileContext } from '../../src/renderer/focus/focus-tile'
import { setView } from '../../src/renderer/session/navigation'
import { resetToasts, toasts } from '../../src/renderer/toast/toasts'

type Result = { ok: true; value: unknown } | { ok: false; error: string }

const ipc = vi.hoisted(() => ({
  machine: null as string | null,
  /** What `tickets.read` answers next, in order; the last one stays. */
  reads: [] as Result[],
  /** Answers of `tickets.read` a test settles itself; taken before `reads`, in order. */
  held: [] as Promise<Result>[],
}))
const invoke = vi.hoisted(() =>
  vi.fn<(channel: string, input?: unknown) => Promise<Result>>((channel) => {
    if (channel === 'tickets.read' && ipc.held.length > 0) return ipc.held.shift()!
    if (channel === 'tickets.read') return Promise.resolve(ipc.reads.length > 1 ? ipc.reads.shift()! : (ipc.reads[0] ?? { ok: false, error: 'no answer' }))
    if (channel === 'shell.openInEditor') return Promise.resolve({ ok: true, value: { path: 'opened', outcome: 'opened' } })
    return Promise.resolve({ ok: false, error: 'not in this test' })
  }),
)
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/renderer/ipc')>()), invoke, windowMachine: () => ipc.machine }))
vi.mock('../../src/renderer/machines/useMachines', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/machines/useMachines')>()),
  useMachines: () => ({ linked: [{ id: 'machine-m', name: 'Mini' }] }),
  linkStateNow: () => ({ linked: [{ id: 'machine-m', name: 'Mini' }] }),
}))

const PROJECT = 'focus-00000033'
const FILE = '/w/.scratch/demo/issues/07-rate-limit.md'
const RELATIVE = '.scratch/demo/issues/07-rate-limit.md'
const TEXT = ['# 07 — Rate limit', '', 'Status: open', '', '## Что делаем', '', 'Read [the spec](../spec.md) and [the ADR](../../../docs/adr/0002-view.md).', ''].join('\n')

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'demo',
    num: 7,
    slug: 'rate-limit',
    title: '07 — Rate limit',
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
    version: 'v1',
    ...over,
  }
}

const model = (t: Ticket): WorkflowModel => ({ root: '/w', epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets: [t], error: null, branchErrors: [] })

function nodeOf(t: Ticket): CanvasFlowNode {
  const found = buildEpicNodes(PROJECT, '/w', model(t), { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, {}).find((node) => node.id === ticketNodeId('demo', t.num))
  if (found === undefined) throw new Error('no Ticket Node')
  return found
}

function propsOf(node: CanvasFlowNode, at = { x: 0, y: 0 }): CanvasNodeProps {
  return {
    id: node.id,
    type: node.type,
    data: node.data,
    selected: false,
    dragging: false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: at.x,
    positionAbsoluteY: at.y,
    draggable: true,
    selectable: true,
    deletable: false,
  } as unknown as CanvasNodeProps
}

const inTile = (element: ReactElement) => (
  <ReactFlowProvider>
    <FocusTileContext.Provider value={true}>{element}</FocusTileContext.Provider>
  </ReactFlowProvider>
)
const onCanvas = (element: ReactElement) => <ReactFlowProvider>{element}</ReactFlowProvider>

const readCalls = () => invoke.mock.calls.filter(([channel]) => channel === 'tickets.read')
const editorCalls = () => invoke.mock.calls.filter(([channel]) => channel === 'shell.openInEditor')

beforeEach(() => {
  resetToasts()
  ipc.machine = null
  ipc.held = []
  ipc.reads = [{ ok: true, value: { path: FILE, relative: RELATIVE, text: TEXT } }]
  invoke.mockClear()
  useFocusState.setState({ request: null })
})

describe('the focused Ticket', () => {
  it('reads its file through tickets.read and shows it as markdown under the header', async () => {
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    const body = await screen.findByTestId('ticket-body')
    await within(body).findByRole('heading', { name: 'Что делаем' })
    expect(within(body).getByRole('heading', { level: 1, name: '07 — Rate limit' })).toBeTruthy()
    expect(readCalls()).toEqual([['tickets.read', { projectId: PROJECT, epic: 'demo', num: 7, slug: 'rate-limit' }]])
    expect(body.getAttribute('data-path')).toBe(FILE)
    // The header stays: number, title and the blockers line.
    const node = screen.getByTestId('ticket-node')
    expect(node.getAttribute('data-focused')).toBe('true')
    expect(within(node).getByText('Rate limit', { selector: '.w-ticket__title' })).toBeTruthy()
    expect(within(node).getByText('no blockers')).toBeTruthy()
  })

  it('opens a relative link of the file from the folder the file is in, relative to the Project root', async () => {
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    fireEvent.click(await screen.findByRole('link', { name: 'the spec' }))
    fireEvent.click(screen.getByRole('link', { name: 'the ADR' }))
    expect(editorCalls()).toEqual([
      ['shell.openInEditor', { projectId: PROJECT, path: '.scratch/demo/spec.md' }],
      ['shell.openInEditor', { projectId: PROJECT, path: 'docs/adr/0002-view.md' }],
    ])
  })

  // worfy-polish ticket 36: the folder was the absolute one, and classifyLink drops the leading `\\`
  // of a UNC path; main resolves the relative path against the Project root instead.
  it.each([
    ['a Project on a share', '\\\\host\\share\\w\\.scratch\\demo\\issues\\07-rate-limit.md', RELATIVE, ['.scratch/demo/spec.md', 'docs/adr/0002-view.md']],
    ['a Silent Project, the Workflow folder next to it', '/wf/.scratch/demo/issues/07-rate-limit.md', '../wf/.scratch/demo/issues/07-rate-limit.md', ['../wf/.scratch/demo/spec.md', '../wf/docs/adr/0002-view.md']],
    ['a file with no path relative to the root, which keeps its absolute folder', 'D:\\wf\\.scratch\\demo\\issues\\07-rate-limit.md', null, ['D:/wf/.scratch/demo/spec.md', 'D:/wf/docs/adr/0002-view.md']],
    // A Linked machine on an older worfy answers no `relative`; the schema takes that answer.
    ['a Linked machine on an older worfy, which answers no relative path', FILE, undefined, ['/w/.scratch/demo/spec.md', '/w/docs/adr/0002-view.md']],
  ])('opens the relative links of %s by the path main answered', async (_, path, relative, opened) => {
    const value = ticketsRead.output.parse(relative === undefined ? { path, text: TEXT } : { path, relative, text: TEXT })
    ipc.reads = [{ ok: true, value }]
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    fireEvent.click(await screen.findByRole('link', { name: 'the spec' }))
    fireEvent.click(screen.getByRole('link', { name: 'the ADR' }))
    expect(editorCalls().map(([, input]) => (input as { path: string }).path)).toEqual(opened)
  })

  it('never shows the answer about the Ticket focused before, when it comes after the answer about this one', async () => {
    const late = deferred()
    ipc.held = [late.promise]
    const { rerender } = render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    ipc.reads = [{ ok: true, value: { path: '/w/.scratch/demo/issues/07-renamed.md', relative: '.scratch/demo/issues/07-renamed.md', text: '# 07\n\n## Now\n' } }]
    rerender(inTile(<TicketNode {...propsOf(nodeOf(ticket({ slug: 'renamed' })))} />))
    await screen.findByRole('heading', { name: 'Now' })
    await act(async () => late.resolve({ ok: true, value: { path: FILE, relative: RELATIVE, text: TEXT } }))
    expect(screen.getByRole('heading', { name: 'Now' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Что делаем' })).toBeNull()
    expect(screen.getByTestId('ticket-body').getAttribute('data-path')).toBe('/w/.scratch/demo/issues/07-renamed.md')
  })

  it('a renamed slug (the same number) is another Ticket: its file is read by the new slug, the old text is not shown meanwhile, nor kept when the read fails', async () => {
    const { rerender } = render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    await screen.findByRole('heading', { name: 'Что делаем' })
    const pending = deferred()
    ipc.held = [pending.promise]
    rerender(inTile(<TicketNode {...propsOf(nodeOf(ticket({ slug: 'renamed' })))} />))
    expect(readCalls().at(-1)).toEqual(['tickets.read', { projectId: PROJECT, epic: 'demo', num: 7, slug: 'renamed' }])
    expect(screen.queryByRole('heading', { name: 'Что делаем' })).toBeNull()
    await act(async () => pending.resolve({ ok: false, error: 'demo/issues/07-renamed.md does not exist' }))
    expect(screen.getByTestId('ticket-body-error').textContent).toBe('The Ticket file could not be read: demo/issues/07-renamed.md does not exist')
    expect(screen.queryByRole('heading', { name: 'Что делаем' })).toBeNull()
    expect(screen.getByTestId('ticket-body').getAttribute('data-path')).toBeNull()
  })

  it('reads the file again for a new version of the Ticket, and not for a new place on the Canvas', async () => {
    const { rerender } = render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    await screen.findByRole('heading', { name: 'Что делаем' })
    ipc.reads = [{ ok: true, value: { path: FILE, relative: RELATIVE, text: '# 07 — Rate limit\n\n## Итог\n\nDone today.\n' } }]
    rerender(inTile(<TicketNode {...propsOf(nodeOf(ticket()), { x: 40, y: 30 })} />))
    expect(readCalls()).toHaveLength(1)
    rerender(inTile(<TicketNode {...propsOf(nodeOf(ticket({ version: 'v2' })))} />))
    await screen.findByRole('heading', { name: 'Итог' })
    expect(screen.queryByRole('heading', { name: 'Что делаем' })).toBeNull()
    expect(readCalls()).toHaveLength(2)
  })

  it('keeps the text it has with the reason when a new read fails', async () => {
    const { rerender } = render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    await screen.findByRole('heading', { name: 'Что делаем' })
    ipc.reads = [{ ok: false, error: 'demo/issues/07-rate-limit.md does not exist' }]
    rerender(inTile(<TicketNode {...propsOf(nodeOf(ticket({ version: 'v3' })))} />))
    expect((await screen.findByTestId('ticket-body-error')).textContent).toBe('The Ticket file could not be read: demo/issues/07-rate-limit.md does not exist')
    expect(screen.getByRole('heading', { name: 'Что делаем' })).toBeTruthy()
  })

  it('says why when the first read fails, and offers no editor without a path', async () => {
    ipc.reads = [{ ok: false, error: 'outside the Project' }]
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    expect((await screen.findByTestId('ticket-body-error')).textContent).toBe('The Ticket file could not be read: outside the Project')
    const button = screen.getByRole('button', { name: 'Open in editor' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('"Open in editor" opens the file at the path main found', async () => {
    ipc.reads = [{ ok: true, value: { path: '/wf/.scratch/demo/issues/07-rate-limit.md', relative: '../wf/.scratch/demo/issues/07-rate-limit.md', text: TEXT } }]
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    await screen.findByRole('heading', { name: 'Что делаем' })
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(editorCalls()).toEqual([['shell.openInEditor', { projectId: PROJECT, path: '/wf/.scratch/demo/issues/07-rate-limit.md' }]])
  })

  // worfy-polish ticket 35: a symlinked Ticket that leads to anything but a document is shown, not opened.
  it('"Open in editor" says why when main showed the file in Explorer instead of opening it', async () => {
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    await screen.findByRole('heading', { name: 'Что делаем' })
    invoke.mockResolvedValueOnce({ ok: true, value: { path: 'C:\\w\\07.lnk', outcome: 'revealed', revealedIn: 'win32' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    await vi.waitFor(() =>
      expect(toasts.getState().toasts).toMatchObject([{ kind: 'info', text: 'Shown in Explorer: not a document', testId: 'file-revealed' }]),
    )
  })

  it('on a Linked machine "Open in editor" says where the file is and opens nothing; the body is still read', async () => {
    ipc.machine = 'machine-m'
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    await screen.findByRole('heading', { name: 'Что делаем' })
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    // A toast of the window (toast/toasts.ts, worfy-ui ticket 16), not a line of the Ticket.
    expect(toasts.getState().toasts).toMatchObject([{ kind: 'info', text: 'File is on Mini', testId: 'file-elsewhere' }])
    expect(editorCalls()).toEqual([])
  })

  it('on a Linked machine "Open in editor" works before the file is read and when it cannot be read: it says where the file is', async () => {
    ipc.machine = 'machine-m'
    ipc.reads = [{ ok: false, error: 'the Machine did not answer' }]
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    const button = screen.getByRole('button', { name: 'Open in editor' }) as HTMLButtonElement
    // No path yet: the button is still there to say where the file is.
    expect(button.disabled).toBe(false)
    await screen.findByTestId('ticket-body-error')
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(toasts.getState().toasts).toMatchObject([{ kind: 'info', text: 'File is on Mini', testId: 'file-elsewhere' }])
    expect(editorCalls()).toEqual([])
  })

  it('a double click in the tile asks for nothing', async () => {
    render(inTile(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    await screen.findByTestId('ticket-body')
    fireEvent.doubleClick(screen.getByTestId('ticket-node'))
    expect(useFocusState.getState().request).toBeNull()
  })
})

describe('the Ticket card on the Canvas', () => {
  it('reads no file, shows no body and no editor button', async () => {
    render(onCanvas(<TicketNode {...propsOf(nodeOf(ticket()))} />))
    await act(async () => undefined)
    expect(readCalls()).toEqual([])
    expect(screen.queryByTestId('ticket-body')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open in editor' })).toBeNull()
    expect(screen.getByTestId('ticket-node').getAttribute('data-focused')).toBeNull()
  })

  it('a double click asks for focus mode on this Ticket instead of opening the editor', () => {
    const node = nodeOf(ticket())
    render(onCanvas(<TicketNode {...propsOf(node)} />))
    fireEvent.doubleClick(screen.getByTestId('ticket-node'))
    expect(useFocusState.getState().request?.ids).toEqual([node.id])
    fireEvent.doubleClick(screen.getByTestId('ticket-node'))
    expect(useFocusState.getState().request?.seq).toBe(2)
    expect(editorCalls()).toEqual([])
  })
})

describe('the way in (FocusEntry) carries out a request for focus mode', () => {
  let restore: () => void = () => undefined

  beforeEach(() => {
    const globals = globalThis as { ResizeObserver?: unknown }
    const observer = globals.ResizeObserver
    globals.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    restore = () => {
      if (observer === undefined) delete globals.ResizeObserver
      else globals.ResizeObserver = observer
    }
    act(() => setView('canvas'))
  })

  afterEach(() => restore())

  const flowNode = (id: string): CanvasFlowNode => ({
    id,
    position: { x: 0, y: 0 },
    data: { node: { id, kind: 'zz-focus-test', x: 0, y: 0, w: 100, h: 100, hidden: false, locked: false, pinned: false, tags: [], data: { title: id.toUpperCase() } } },
  })

  it('opens focus mode on the Node asked for, nothing selected; a request made before the Canvas was there is not carried out', () => {
    act(() => requestFocus(['b']))
    render(
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={[flowNode('a'), flowNode('b')]}>
          <FocusEntry />
        </ReactFlow>
      </div>,
    )
    expect(screen.queryByTestId('focus-mode')).toBeNull()
    act(() => requestFocus(['b']))
    const layer = screen.getByTestId('focus-mode')
    expect(within(layer).getAllByTestId('focus-tile').map((tile) => tile.getAttribute('data-node-id'))).toEqual(['b'])
  })

  it('draws a Ticket in the tile with its body', async () => {
    const node = nodeOf(ticket())
    render(
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={[node]}>
          <FocusEntry />
        </ReactFlow>
      </div>,
    )
    act(() => requestFocus([node.id]))
    const tile = screen.getByTestId('focus-tile')
    await waitFor(() => expect(within(tile).getByRole('heading', { name: 'Что делаем' })).toBeTruthy())
    expect(within(tile).getByTestId('ticket-node').getAttribute('data-focused')).toBe('true')
  })
})

/** A promise and the hand that settles it. */
function deferred(): { promise: Promise<Result>; resolve: (result: Result) => void } {
  let resolve: (result: Result) => void = () => undefined
  const promise = new Promise<Result>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('folderOf', () => {
  it.each([
    ['/w/.scratch/e/issues/01-a.md', '/w/.scratch/e/issues'],
    ['/01-a.md', '/'],
    ['C:\\w\\.scratch\\e\\issues\\01-a.md', 'C:\\w\\.scratch\\e\\issues'],
    ['C:\\01-a.md', 'C:\\'],
  ])('%s → %s', (path, folder) => {
    expect(folderOf(path)).toBe(folder)
  })
})
