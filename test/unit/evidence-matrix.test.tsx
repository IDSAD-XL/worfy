// The Evidence of a Ticket in the window (worfy-evidence ticket 06): the chip «Evidence n/m» on its card — green,
// red or neutral, with the three counts in its tooltip, none without checkbox items — and the matrix above
// its text in focus mode: a row per item with its state («Verified», «Not verified: <reason>», «Failed») and
// its Evidence lines, whose links open the source through main — the SHA and `PR #N` on the repository's
// page, a URL as it is, a screenshot from the Ticket file's folder in its default program — and stay text
// without the repository's page. The card gets a line of room for the chip, and the repository's page
// survives a workflow delta.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evidenceItems } from '../../src/shared/workflow/evidence'
import type { EvidenceItem, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import Evidence from '../../src/renderer/canvas/badges/Evidence'
import { EvidenceMatrix } from '../../src/renderer/canvas/nodes/EvidenceMatrix'
import type { CanvasFlowNode, CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import TicketNode from '../../src/renderer/canvas/nodes/TicketNode'
import { buildEpicNodes, ticketNodeId } from '../../src/renderer/canvas/sources/epics'
import { cardHeight, EVIDENCE_LINE, type CardInput } from '../../src/renderer/canvas/ticket-card'
import { FocusTileContext } from '../../src/renderer/focus/focus-tile'
import { resetToasts, toasts } from '../../src/renderer/toast/toasts'
import { applyWorkflowDelta } from '../../src/renderer/workflow/useWorkflow'

type Result = { ok: true; value: unknown } | { ok: false; error: string }

const ipc = vi.hoisted(() => ({ machine: null as string | null, text: '' }))
const invoke = vi.hoisted(() =>
  vi.fn<(channel: string, input?: unknown) => Promise<Result>>((channel) => {
    if (channel === 'shell.openExternal') return Promise.resolve({ ok: true, value: { url: 'opened' } })
    if (channel === 'shell.openInEditor') return Promise.resolve({ ok: true, value: { path: 'opened', outcome: 'opened' } })
    if (channel === 'tickets.read') return Promise.resolve({ ok: true, value: { path: `/w/${RELATIVE}`, relative: RELATIVE, text: ipc.text } })
    return Promise.resolve({ ok: false, error: 'not in this test' })
  }),
)
vi.mock('../../src/renderer/ipc', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/renderer/ipc')>()), invoke, windowMachine: () => ipc.machine }))
vi.mock('../../src/renderer/machines/useMachines', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/machines/useMachines')>()),
  useMachines: () => ({ linked: [{ id: 'machine-m', name: 'Mini' }] }),
  linkStateNow: () => ({ linked: [{ id: 'machine-m', name: 'Mini' }] }),
}))
// Only the Evidence badge on the card; the other badges and the actions are their own tests' business.
vi.mock('../../src/renderer/canvas/badges', async () => {
  const module = await import('../../src/renderer/canvas/badges/Evidence')
  return { actions: [], badges: [{ id: 'Evidence', order: module.order, Component: module.default }] }
})

const PROJECT = 'evidence-00000006'
const REPO = 'https://github.com/example/demo'
const RELATIVE = '.scratch/demo/issues/06-chip.md'
const FOLDER = '.scratch/demo/issues'
const SHA = '3f2a1b9c0d4e5f60718293a4b5c6d7e8f9012345'

/** A done section with one item in each state and a line of each link kind. */
const DONE = [
  '# 06 — Chip',
  '',
  'Status: open',
  '',
  '## Done when',
  '',
  '- [x] Unit test of the chip',
  `  - evidence: test-run pass · \`pnpm test test/unit/evidence-matrix.test.tsx\` exit 0 · mac dev · ${SHA}`,
  `  - evidence: review pass · PR #1330 · - - · ${SHA}`,
  '- [ ] (manual) The canvas on the PC',
  '  - needs: windows stable',
  '  - evidence: screenshot pass · `../evidence/06-chip-light.png` · windows installed · bacbbcef · scrub: 2026-11-04',
  '- [ ] CI of the PR green',
  '  - evidence: ci-check fail · https://github.com/example/demo/actions/runs/42 · ci ci · bacbbcef',
  '',
].join('\n')

const items = () => evidenceItems(DONE)
const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel).map(([, input]) => input)

beforeEach(() => {
  ipc.machine = null
  ipc.text = DONE
  invoke.mockClear()
  resetToasts()
})

describe('the chip «Evidence n/m»', () => {
  it('is green when every item is verified, red when one failed, neutral otherwise; its tooltip counts the three states', () => {
    const states = (...list: EvidenceItem['state'][]): EvidenceItem[] => list.map((state, i) => ({ ...items()[0]!, index: i + 1, state }))
    const face = (evidence: EvidenceItem[]) => {
      const { container, unmount } = render(<Evidence subject={{ kind: 'ticket', projectId: PROJECT, root: '/w', ticket: { ...base(), evidence } }} />)
      const chip = container.querySelector('[data-testid="evidence-chip"]')
      const seen = [chip?.getAttribute('data-value'), chip?.textContent, chip?.getAttribute('title')]
      unmount()
      return seen
    }
    expect(face(states('verified', 'verified'))).toEqual(['ready', 'Evidence 2/2', '2 verified, 0 not verified, 0 failed'])
    expect(face(items())).toEqual(['blocked', 'Evidence 1/3', '1 verified, 1 not verified, 1 failed'])
    expect(face(states('verified', 'not-verified', 'not-verified', 'verified', 'verified'))).toEqual(['open', 'Evidence 3/5', '3 verified, 2 not verified, 0 failed'])
  })

  it('a Ticket without checkbox items has no chip', () => {
    const ticket = { ...base(), evidence: evidenceItems('# 06\n\n## Что делаем\n\ntext\n') }
    expect(ticket.evidence).toEqual([])
    const { container } = render(<Evidence subject={{ kind: 'ticket', projectId: PROJECT, root: '/w', ticket }} />)
    expect(container.innerHTML).toBe('')
    const old = render(<Evidence subject={{ kind: 'ticket', projectId: PROJECT, root: '/w', ticket: base() }} />)
    expect(old.container.innerHTML).toBe('')
  })

  it('draws the state colour with its word and the counts as tooltip', () => {
    render(<Evidence subject={{ kind: 'ticket', projectId: PROJECT, root: '/w', ticket: { ...base(), evidence: items() } }} />)
    const chip = screen.getByTestId('evidence-chip')
    expect(chip.textContent).toBe('Evidence 1/3')
    expect(chip.getAttribute('data-value')).toBe('blocked')
    expect(chip.getAttribute('title')).toBe('1 verified, 1 not verified, 1 failed')
    expect(chip.querySelector('.w-chip--blocked')).not.toBeNull()
  })

  it('takes a line of its own on the card: only a Ticket with items is taller, by one line of chips', () => {
    const card: CardInput = { num: 6, title: 'Chip', state: 'open', ready: false, reason: null, meta: { lead: 'no blockers', nums: null, tail: '', attention: false } }
    expect(cardHeight({ ...card, evidence: true })).toBe(cardHeight(card) + EVIDENCE_LINE)
    expect(cardHeight({ ...card, evidence: false })).toBe(cardHeight(card))
    expect(EVIDENCE_LINE).toBe(18)
  })
})

describe('the Evidence matrix', () => {
  it('shows each item with its state: Verified, Not verified with the reason, Failed', () => {
    render(<EvidenceMatrix projectId={PROJECT} items={items()} repoUrl={REPO} baseDir={FOLDER} />)
    const matrix = screen.getByTestId('evidence-matrix')
    expect(within(matrix).getByRole('heading').textContent).toBe('Evidence · 1 of 3 verified')
    const rows = within(matrix).getAllByTestId('evidence-item')
    expect(rows.map((row) => [row.getAttribute('data-index'), within(row).getByTestId('evidence-state').textContent])).toEqual([
      ['1', 'Verified'],
      ['2', 'Not verified: needs windows stable, got windows installed'],
      ['3', 'Failed'],
    ])
    expect(rows.map((row) => row.querySelector('.w-chip')?.getAttribute('data-status'))).toEqual(['ready', 'working', 'blocked'])
    expect(within(rows[0]!).getByTitle('Unit test of the chip')).toBeTruthy()
    // Kind and verdict, platform and copy, the short SHA, the ref.
    expect(within(rows[0]!).getAllByTestId('evidence-line').map((line) => line.textContent)).toEqual([
      'test-run pass · mac dev · 3f2a1b9 · `pnpm test test/unit/evidence-matrix.test.tsx` exit 0',
      'review pass · 3f2a1b9 · PR #1330',
    ])
    expect(within(rows[1]!).getByTestId('evidence-line').textContent).toBe('screenshot pass · windows installed · bacbbce · ../evidence/06-chip-light.png · scrub: 2026-11-04')
  })

  it('opens the commit and the PR on the repository page, a URL as it is, all with shell.openExternal', async () => {
    render(<EvidenceMatrix projectId={PROJECT} items={items()} repoUrl={`${REPO}/`} baseDir={FOLDER} />)
    const first = screen.getAllByTestId('evidence-item')[0]!
    fireEvent.click(within(first).getAllByRole('link', { name: '3f2a1b9' })[0]!)
    fireEvent.click(within(first).getByRole('link', { name: 'PR #1330' }))
    fireEvent.click(screen.getByRole('link', { name: 'https://github.com/example/demo/actions/runs/42' }))
    await waitFor(() =>
      expect(calls('shell.openExternal')).toEqual([{ url: `${REPO}/commit/${SHA}` }, { url: `${REPO}/pull/1330` }, { url: 'https://github.com/example/demo/actions/runs/42' }]),
    )
    // A command is text, not a link.
    expect(within(first).queryByRole('link', { name: /pnpm test/ })).toBeNull()
    expect(calls('shell.openInEditor')).toEqual([])
  })

  it('opens a screenshot from the Ticket file’s folder with shell.openInEditor; on a Linked machine shows where the file is', async () => {
    const { unmount } = render(<EvidenceMatrix projectId={PROJECT} items={items()} repoUrl={REPO} baseDir={FOLDER} />)
    fireEvent.click(screen.getByRole('link', { name: '../evidence/06-chip-light.png' }))
    await waitFor(() => expect(calls('shell.openInEditor')).toEqual([{ projectId: PROJECT, path: '.scratch/demo/evidence/06-chip-light.png' }]))
    expect(calls('shell.openExternal')).toEqual([])
    unmount()

    ipc.machine = 'machine-m'
    render(<EvidenceMatrix projectId={PROJECT} items={items()} repoUrl={REPO} baseDir={FOLDER} />)
    fireEvent.click(screen.getByRole('link', { name: '../evidence/06-chip-light.png' }))
    expect(toasts.getState().toasts.map((toast) => toast.text)).toEqual(['File is on Mini'])
    expect(calls('shell.openInEditor')).toHaveLength(1)
  })

  it('without the repository page the SHA and the PR are text; a URL still opens', () => {
    render(<EvidenceMatrix projectId={PROJECT} items={items()} repoUrl={null} baseDir={FOLDER} />)
    const first = screen.getAllByTestId('evidence-item')[0]!
    expect(within(first).queryAllByRole('link')).toEqual([])
    expect(within(first).getAllByText('3f2a1b9')).toHaveLength(2)
    expect(within(first).getByText('PR #1330')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'https://github.com/example/demo/actions/runs/42' })).toBeTruthy()
  })

  it('reads each kind of ref: PR, https URL, a path in backticks; a command, an http URL and an unread folder stay text', () => {
    const refs = ['PR #7', 'https://example.com/run/1', 'http://example.com/run/1', '`notes/run.txt`', '`pnpm test` exit 0', '`pnpm`']
    const lines = refs.map((ref) => `  - evidence: test-run pass · ${ref} · mac dev · bacbbcef`)
    const many = evidenceItems(['## Done when', '', '- [ ] Every kind of ref', ...lines, ''].join('\n'))
    const seen = (repoUrl: string | null, baseDir: string | undefined) => {
      const { unmount } = render(<EvidenceMatrix projectId={PROJECT} items={many} repoUrl={repoUrl} baseDir={baseDir} />)
      const out = screen.getAllByTestId('evidence-line').map((line) => {
        const link = line.querySelector('[data-testid="evidence-ref"]')
        return link === null ? `text ${line.textContent!.split(' · ').at(-1)}` : `link ${link.textContent} -> ${link.getAttribute('href')}`
      })
      unmount()
      return out
    }
    expect(seen(REPO, FOLDER)).toEqual([
      `link PR #7 -> ${REPO}/pull/7`,
      'link https://example.com/run/1 -> https://example.com/run/1',
      'text http://example.com/run/1',
      'link notes/run.txt -> .scratch/demo/issues/notes/run.txt',
      'text `pnpm test` exit 0',
      'text `pnpm`',
    ])
    // Without the repository page the PR is text; before the file is read its folder is unknown and the path is text.
    expect(seen(null, undefined)).toEqual(['text PR #7', 'link https://example.com/run/1 -> https://example.com/run/1', 'text http://example.com/run/1', 'text notes/run.txt', 'text `pnpm test` exit 0', 'text `pnpm`'])
  })

  it('draws nothing for a Ticket without checkbox items', () => {
    const { container } = render(<EvidenceMatrix projectId={PROJECT} items={[]} repoUrl={REPO} baseDir={FOLDER} />)
    expect(container.innerHTML).toBe('')
  })
})

// ── the focused Ticket ─────────────────────────────────────────────────────

function base(over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'demo',
    num: 6,
    slug: 'chip',
    title: '06 — Chip',
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

function propsOf(t: Ticket): CanvasNodeProps {
  const model: WorkflowModel = { root: '/w', epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets: [t], error: null, branchErrors: [] }
  const node: CanvasFlowNode | undefined = buildEpicNodes(PROJECT, '/w', model, { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }, {}).find(
    (each) => each.id === ticketNodeId('demo', t.num),
  )
  if (node === undefined) throw new Error('no Ticket Node')
  return { id: node.id, type: node.type, data: node.data, selected: false, dragging: false, isConnectable: false, zIndex: 0, positionAbsoluteX: 0, positionAbsoluteY: 0 } as unknown as CanvasNodeProps
}

const inTile = (t: Ticket) => (
  <ReactFlowProvider>
    <FocusTileContext.Provider value={true}>
      <TicketNode {...propsOf(t)} />
    </FocusTileContext.Provider>
  </ReactFlowProvider>
)

describe('the focused Ticket', () => {
  it('shows the matrix above its text, with the chip on its card; the file’s folder resolves a screenshot', async () => {
    render(inTile(base({ evidence: items() })))
    const body = await screen.findByTestId('ticket-body')
    const matrix = screen.getByTestId('evidence-matrix')
    // The matrix comes first, then the text.
    expect(matrix.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('evidence-chip').textContent).toBe('Evidence 1/3')
    fireEvent.click(await within(matrix).findByRole('link', { name: '../evidence/06-chip-light.png' }))
    await waitFor(() => expect(calls('shell.openInEditor')).toEqual([{ projectId: PROJECT, path: '.scratch/demo/evidence/06-chip-light.png' }]))
  })

  it('has no matrix and no chip without the done section', async () => {
    ipc.text = '# 06 — Chip\n\nStatus: open\n\n## Что делаем\n\ntext\n'
    render(inTile(base({ evidence: evidenceItems(ipc.text) })))
    await screen.findByTestId('ticket-body')
    expect(screen.queryByTestId('evidence-matrix')).toBeNull()
    expect(screen.queryByTestId('evidence-chip')).toBeNull()
  })
})

describe('the repository page in the window', () => {
  it('survives a workflow delta, which does not carry it', () => {
    const model: WorkflowModel = { root: '/w', epics: [], tickets: [base()], error: null, branchErrors: [], repoUrl: REPO }
    const after = applyWorkflowDelta(model, { root: '/w', epics: [], tickets: [base({ evidence: items() })], removedEpics: [], removedTickets: [], error: null, branchErrors: [] })
    expect(after.repoUrl).toBe(REPO)
    expect(after.tickets[0]!.evidence).toHaveLength(3)
    const none = applyWorkflowDelta({ ...model, repoUrl: null }, { root: '/w', epics: [], tickets: [], removedEpics: [], removedTickets: [], error: null, branchErrors: [] })
    expect(none.repoUrl).toBeNull()
  })
})
