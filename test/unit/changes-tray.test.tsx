// The comments on lines of the Changes screen (worfy-changes-view ticket 05): the Node src/renderer/canvas/nodes/
// ChangesNode.tsx with its comments (changes/line-comments.tsx, LineComment.tsx, Tray.tsx), over a bridge that answers
// the `changes.*` channels as main would. What is checked is what the user sees and what the store of the Session in
// «To» holds (session/quote-store.ts), the store that Session's input field lists:
// - «+» in the gutter, the key c on a line clicked, and a range (a click, then a click with Shift) open the popover
//   on those lines; Save puts the comment into the Session's store and under its last line;
// - the tray lists the comments of the Session in «To», its comments on messages too;
// - another Session in «To» takes the comments on code of this Ticket; the comments on messages stay;
// - Send sends one message with the section of the comments on lines;
// - a read-only screen has no «+», no c and no tray, and its diff reads.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChangesNode from '../../src/renderer/canvas/nodes/ChangesNode'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { LayoutOpsContext, type LayoutOps } from '../../src/renderer/canvas/useLayout'
import { forgetSentLinesInMemory } from '../../src/renderer/changes/sent-lines'
import type { CodeComment, MessageComment } from '../../src/renderer/session/quote-comments'
import { addDraft, forgetQuotesInMemory, quoteKey, readQuotes } from '../../src/renderer/session/quote-store'
import type { ChangedFile, DiffLine, FileDiff } from '../../src/shared/changes/types'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

let readOnly: string | null = null
vi.mock('../../src/renderer/projects/useProjects', async (original) => ({ ...(await original<typeof import('../../src/renderer/projects/useProjects')>()), useReadOnly: () => readOnly }))

const ROOT = '/Users/test/projects/demo'
const PROJECT = 'demo-0000000d'
const PATH = 'src/orders/cart.ts'
const KEY_A = quoteKey(PROJECT, 'session:a', 'sdk-a')
const KEY_ORCH = quoteKey(PROJECT, 'orchestrator', 'orch-sdk')

const TICKET: Ticket = {
  epic: 'demo',
  num: 3,
  slug: 'cart',
  title: '03 — Cart',
  statusRaw: 'claimed',
  state: 'work',
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: 'demo/03',
}

const changed = (path: string): ChangedFile => ({ path, oldPath: null, status: 'M', additions: 2, deletions: 1, binary: false, oldMode: '100644', newMode: '100644', oldBlob: 'a', newBlob: 'b', untracked: false, workflow: false, fold: null })

const line = (kind: DiffLine['kind'], text: string, oldLine: number | null, newLine: number | null): DiffLine => ({ kind, text, oldLine, newLine, crlf: false, noNewline: false })

const CART_DIFF: FileDiff = {
  kind: 'hunks',
  path: PATH,
  oldPath: null,
  oldMode: '100644',
  newMode: '100644',
  whole: false,
  hunks: [
    {
      header: '@@ -1,3 +1,4 @@',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      section: '',
      lines: [line('context', "import { sum } from './money'", 1, 1), line('del', '  taxRate: number', 2, null), line('add', '  discount?: Discount', null, 2), line('add', 'const MAX = 0.5', null, 3), line('context', '}', 3, 4)],
    },
  ],
}

const TARGETS = {
  targets: [
    { kind: 'session', nodeId: 'session:a', sessionId: 'sdk-a', title: 'Session sdk-a', lastAt: 1 },
    { kind: 'orchestrator', nodeId: 'orchestrator', sessionId: 'orch-sdk', title: 'Orchestrator', lastAt: null },
  ],
  defaultNodeId: 'session:a',
  autopilot: false,
}

let calls: { channel: string; input: Record<string, unknown> }[]
let targets: unknown

function answer(channel: string, input: Record<string, unknown>): unknown {
  const base = { ref: 'origin/main', from: 'worktree.base', mergeBase: '4f9c2e1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
  switch (channel) {
    case 'projects.list':
      return { projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 }
    case 'workflow.open':
      return { root: ROOT, epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets: [TICKET], error: null, branchErrors: [] } satisfies WorkflowModel
    case 'changes.scopes':
      return { repos: [{ repo: 'demo', kind: 'worktree', branch: 'demo/03', headSha: 'c0ffee1', base, scopes: ['all', 'uncommitted'], branches: ['main'], error: null, checkout: ROOT, worktree: '.claude/worktrees/03' }] }
    case 'changes.list':
      return { repos: [{ repo: 'demo', kind: 'worktree', branch: 'demo/03', scope: (input.scope as { kind: string }).kind, base, headSha: 'c0ffee1', workTree: true, files: [changed(PATH)], additions: 2, deletions: 1, error: null }] }
    case 'changes.file':
      return { file: CART_DIFF }
    case 'changes.commits':
      return { base, commits: [] }
    case 'changes.targets':
      return targets
    case 'sessions.start':
      return { projectId: PROJECT, nodeId: input.nodeId, vendor: 'claude', sessionId: 'sdk-a', sdkSessionId: 'sdk-a', state: 'idle', error: null, cwd: ROOT, model: null, version: 1 }
    case 'agent.send':
      return undefined
    default:
      return { closed: true }
  }
}

beforeEach(() => {
  readOnly = null
  calls = []
  targets = TARGETS
  globalThis.localStorage.clear()
  forgetQuotesInMemory()
  forgetSentLinesInMemory()
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string, input: Record<string, unknown>) => {
      calls.push({ channel, input })
      return Promise.resolve({ ok: true, value: answer(channel, input) })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  forgetQuotesInMemory()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const ops: LayoutOps = { apply: () => Promise.resolve() }

const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 20))
  })

async function open() {
  const props = { id: 'changes:demo/3', data: { node: { data: { ticket: { epic: 'demo', num: 3 } } } }, selected: false } as unknown as CanvasNodeProps
  render(
    <ReactFlowProvider>
      <LayoutOpsContext.Provider value={ops}>
        <ChangesNode {...props} />
      </LayoutOpsContext.Provider>
    </ReactFlowProvider>,
  )
  await screen.findAllByTestId('changes-line')
  await settle()
}

/** The row of a line of the new side (or the old one). */
const row = (number: number, side: 'old' | 'new' = 'new'): HTMLElement => screen.getAllByTestId('changes-line').find((each) => each.dataset.side === side && each.dataset.line === String(number))!

async function writeAndSave(text: string) {
  const popover = await screen.findByTestId('changes-comment-popover')
  fireEvent.change(within(popover).getByTestId('changes-comment-text'), { target: { value: text } })
  fireEvent.click(within(popover).getByTestId('changes-comment-save'))
  await settle()
}

const codeComment = (over: Partial<CodeComment> = {}): CodeComment => ({
  kind: 'code',
  id: 'c-old',
  path: PATH,
  repository: ROOT,
  side: 'new',
  startLine: 3,
  endLine: 3,
  code: 'const MAX = 0.5',
  commit: null,
  subject: { kind: 'ticket', epic: 'demo', number: '03' },
  worktree: '.claude/worktrees/03',
  branch: 'demo/03',
  text: 'Why 0.5?',
  images: [],
  at: 1,
  ...over,
})

const messageComment: MessageComment = { id: 'q-1', anchor: 'm1#00000000', start: 0, end: 5, quote: 'Hello there', text: 'what?', images: [], messageAt: null, at: 2 }

describe('a comment on lines', () => {
  it('«+» in the gutter opens the popover on its line; Save puts it into the store of the Session in «To» and under the line', async () => {
    await open()
    fireEvent.click(within(row(2)).getByTestId('changes-line-plus'))
    const popover = await screen.findByTestId('changes-comment-popover')
    expect(within(popover).getByTestId('changes-comment-where').textContent).toBe(`${PATH}:2 · new side`)
    expect(within(popover).getByTestId('changes-comment-code').textContent).toBe('  discount?: Discount')
    await writeAndSave('Keep the old name')
    const [saved] = readQuotes(KEY_A).drafts as CodeComment[]
    expect(saved).toMatchObject({ kind: 'code', path: PATH, repository: ROOT, side: 'new', startLine: 2, endLine: 2, code: '  discount?: Discount', commit: null, worktree: '.claude/worktrees/03', branch: 'demo/03', text: 'Keep the old name', subject: { kind: 'ticket', epic: 'demo', number: '03' } })
    const box = screen.getByTestId('changes-comment')
    expect(box.textContent).toContain('Keep the old name')
    expect(screen.getByTestId('changes-tray-count').textContent).toBe('1 comment on 1 file')
  })

  it('the key c opens the popover on the line clicked; a click with Shift makes a range', async () => {
    await open()
    const body = screen.getByTestId('changes-body')
    fireEvent.click(row(2).querySelector('.w-changes__code')!)
    fireEvent.keyDown(body, { key: 'c' })
    let popover = await screen.findByTestId('changes-comment-popover')
    expect(within(popover).getByTestId('changes-comment-where').textContent).toBe(`${PATH}:2 · new side`)
    fireEvent.click(within(popover).getByTestId('changes-comment-cancel'))
    await settle()
    expect(screen.queryByTestId('changes-comment-popover')).toBeNull()

    fireEvent.click(row(4).querySelector('.w-changes__code')!, { shiftKey: true })
    expect(row(2).classList.contains('is-picked') && row(3).classList.contains('is-picked') && row(4).classList.contains('is-picked')).toBe(true)
    fireEvent.keyDown(body, { key: 'c' })
    popover = await screen.findByTestId('changes-comment-popover')
    expect(within(popover).getByTestId('changes-comment-where').textContent).toBe(`${PATH}:2–4 · new side`)
    expect(within(popover).getByTestId('changes-comment-code').textContent).toBe('  discount?: Discount\nconst MAX = 0.5\n}')
    await writeAndSave('One block')
    expect((readQuotes(KEY_A).drafts as CodeComment[]).map((each) => [each.startLine, each.endLine])).toEqual([[2, 4]])
  })

  it('a deleted line takes a comment on the old side, at the base commit', async () => {
    await open()
    fireEvent.click(within(row(2, 'old')).getByTestId('changes-line-plus'))
    await writeAndSave('Was used by tax.ts')
    expect(readQuotes(KEY_A).drafts).toMatchObject([{ side: 'old', startLine: 2, code: '  taxRate: number', commit: '4f9c2e1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }])
  })
})

describe('the tray', () => {
  it('lists the comments of the Session in «To», its comments on messages too', async () => {
    addDraft(KEY_A, codeComment())
    addDraft(KEY_A, messageComment)
    addDraft(KEY_ORCH, codeComment({ id: 'c-orch', startLine: 1, endLine: 1, code: "import { sum } from './money'" }))
    await open()
    const tray = screen.getByTestId('changes-tray')
    expect(within(tray).getByTestId('changes-tray-count').textContent).toBe('1 comment on 1 file · 1 on messages')
    expect(within(tray).getAllByTestId('changes-tray-chip').map((chip) => chip.textContent)).toEqual(['«Hello there»×', 'cart.ts:3×'])
    expect(within(tray).getByTestId('changes-to').textContent).toBe('Session sdk-a')
    // The comment stands under its line; the Orchestrator's does not.
    expect(screen.getAllByTestId('changes-comment').map((box) => box.dataset.commentId)).toEqual(['c-old'])
  })

  it('another Session in «To» takes the comments on code of this Ticket; the comments on messages stay', async () => {
    addDraft(KEY_A, codeComment())
    addDraft(KEY_A, codeComment({ id: 'c-other', subject: { kind: 'ticket', epic: 'demo', number: '07' } }))
    addDraft(KEY_A, messageComment)
    await open()
    fireEvent.click(screen.getByTestId('changes-to'))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Orchestrator/u }))
    await settle()
    expect(readQuotes(KEY_ORCH).drafts.map((each) => each.id)).toEqual(['c-old'])
    expect(readQuotes(KEY_A).drafts.map((each) => each.id).sort()).toEqual(['c-other', 'q-1'])
    expect(screen.getByTestId('changes-to').textContent).toBe('Orchestrator')
    expect(screen.getByTestId('changes-tray-count').textContent).toBe('1 comment on 1 file')
  })

  it('without a bound Session the default is the Orchestrator, and «Autopilot is running» shows while Autopilot runs', async () => {
    targets = { targets: [TARGETS.targets[1]], defaultNodeId: 'orchestrator', autopilot: true }
    await open()
    expect(screen.getByTestId('changes-to').textContent).toBe('Orchestrator')
    expect(screen.getByTestId('changes-to-autopilot').textContent).toBe('Autopilot is running')
  })

  it('Send sends one message with the section of the comments on lines, and the comment stays dim on its line', async () => {
    addDraft(KEY_A, codeComment())
    await open()
    fireEvent.change(screen.getByTestId('changes-tray-text'), { target: { value: 'Fix it, then run the tests.' } })
    fireEvent.click(screen.getByTestId('changes-tray-send'))
    await settle()
    const sends = calls.filter((call) => call.channel === 'agent.send')
    expect(sends).toHaveLength(1)
    expect(sends[0]!.input.sessionId).toBe('sdk-a')
    expect(sends[0]!.input.text).toBe(
      ['Comments on lines of the diff (1), worktree .claude/worktrees/03, branch demo/03:', '', `1. ${PATH}:3 (new side, uncommitted)`, '   > const MAX = 0.5', '   Why 0.5?', '', 'General:', 'Fix it, then run the tests.'].join('\n'),
    )
    expect(readQuotes(KEY_A).drafts).toEqual([])
    expect(readQuotes(KEY_A).pending).toHaveLength(1)
    expect(screen.queryByTestId('changes-comment')).toBeNull()
    expect(screen.getByTestId('changes-comment-sent').textContent).toContain('Why 0.5?')
  })
})

describe('a read-only screen', () => {
  it('has no «+», no c and no tray; the diff reads', async () => {
    readOnly = 'Mini gives this Machine read-only access'
    addDraft(KEY_A, codeComment())
    await open()
    expect(screen.getAllByTestId('changes-line').length).toBe(5)
    expect(screen.queryAllByTestId('changes-line-plus')).toEqual([])
    expect(screen.queryByTestId('changes-tray')).toBeNull()
    expect(screen.queryByTestId('changes-comment')).toBeNull()
    fireEvent.click(row(2).querySelector('.w-changes__code')!)
    fireEvent.keyDown(screen.getByTestId('changes-body'), { key: 'c' })
    await settle()
    expect(screen.queryByTestId('changes-comment-popover')).toBeNull()
    expect(calls.some((call) => call.channel === 'changes.targets')).toBe(false)
  })
})
