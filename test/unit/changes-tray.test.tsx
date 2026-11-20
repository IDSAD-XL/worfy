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
import { addDraft, forgetQuotesInMemory, quoteKey, readQuotes, removeDrafts } from '../../src/renderer/session/quote-store'
import { toasts } from '../../src/renderer/toast/toasts'
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
/** The patch `changes.file` answers with, by what it is asked. */
let fileDiff: (input: Record<string, unknown>) => FileDiff
/** Channels whose answer waits for the test: the promise the bridge waits on, by channel. */
let held: Map<string, Promise<void>>

/** Holds the answers of a channel until the function returned is called. */
function hold(channel: string): () => Promise<void> {
  let release = () => {}
  held.set(
    channel,
    new Promise<void>((done) => {
      release = done
    }),
  )
  return async () => {
    held.delete(channel)
    release()
    await settle()
  }
}

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
      return { file: fileDiff(input) }
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
  fileDiff = () => CART_DIFF
  held = new Map()
  globalThis.localStorage.clear()
  forgetQuotesInMemory()
  forgetSentLinesInMemory()
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel: string, input: Record<string, unknown>) => {
      calls.push({ channel, input })
      return (held.get(channel) ?? Promise.resolve()).then(() => ({ ok: true, value: answer(channel, input) }))
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

// ── round 1 of the review (PR #2049): Send, «To» and Refresh ───────────────────────────────────

const hunks = (header: string, lines: DiffLine[]): FileDiff => ({ ...CART_DIFF, hunks: [{ header, oldStart: 1, oldLines: 3, newStart: 1, newLines: lines.length, section: '', lines }] })
/** `const MAX = 0.5` moved from line 3 to line 4. */
const MOVED_DIFF = hunks('@@ -1,3 +1,5 @@', [line('context', "import { sum } from './money'", 1, 1), line('del', '  taxRate: number', 2, null), line('add', '  discount?: Discount', null, 2), line('add', 'const MIN = 0', null, 3), line('add', 'const MAX = 0.5', null, 4), line('context', '}', 3, 5)])
/** `const MAX = 0.5` gone: line 3 is `}` now. */
const GONE_DIFF = hunks('@@ -1,3 +1,3 @@', [line('context', "import { sum } from './money'", 1, 1), line('del', '  taxRate: number', 2, null), line('add', '  discount?: Discount', null, 2), line('context', '}', 3, 3)])
/** A hunk far from line 3: the read does not show it. */
const FAR_DIFF: FileDiff = { ...CART_DIFF, hunks: [{ header: '@@ -20,2 +20,2 @@', oldStart: 20, oldLines: 2, newStart: 20, newLines: 2, section: '', lines: [line('context', 'a', 20, 20), line('del', 'b', 21, null), line('add', 'c', null, 21)] }] }

const to = (): HTMLButtonElement => screen.getByTestId('changes-to')
const chipText = (): string => screen.getByTestId('changes-tray-chip').textContent ?? ''

async function refresh() {
  fireEvent.click(screen.getByTestId('changes-refresh'))
  await settle()
  await settle()
}

describe('while Send runs', () => {
  it('«To», the field, × and Clear are locked; the round goes to the Session it was sent to', async () => {
    addDraft(KEY_A, codeComment())
    await open()
    fireEvent.change(screen.getByTestId('changes-tray-text'), { target: { value: 'Fix it' } })
    const release = hold('sessions.start')
    fireEvent.click(screen.getByTestId('changes-tray-send'))
    await settle()
    expect(to().disabled).toBe(true)
    fireEvent.click(to())
    expect(screen.queryByRole('menuitemradio', { name: /Orchestrator/u })).toBeNull()
    expect((screen.getByTestId('changes-tray-text') as HTMLTextAreaElement).readOnly).toBe(true)
    expect((screen.getByTestId('changes-tray-remove') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('changes-tray-clear') as HTMLButtonElement).disabled).toBe(true)
    await release()
    expect(calls.filter((call) => call.channel === 'agent.send')).toHaveLength(1)
    expect(readQuotes(KEY_A).pending.map((round) => round.comments.map((each) => each.id))).toEqual([['c-old']])
    expect(readQuotes(KEY_A).drafts).toEqual([])
    expect(readQuotes(KEY_ORCH).drafts).toEqual([])
    expect(to().disabled).toBe(false)
  })

  it('Edit and Delete under a line wait; a popover open before Send does not change the comment', async () => {
    addDraft(KEY_A, codeComment())
    await open()
    fireEvent.click(screen.getByTestId('changes-comment-edit'))
    const popover = await screen.findByTestId('changes-comment-popover')
    fireEvent.change(within(popover).getByTestId('changes-comment-text'), { target: { value: 'Why not 0.6?' } })
    const release = hold('sessions.start')
    fireEvent.click(screen.getByTestId('changes-tray-send'))
    await settle()
    fireEvent.click(within(popover).getByTestId('changes-comment-save'))
    await settle()
    expect(within(screen.getByTestId('changes-comment-popover')).getByTestId('changes-comment-error').textContent).toContain('cannot change now')
    fireEvent.click(within(screen.getByTestId('changes-comment-popover')).getByTestId('changes-comment-cancel'))
    await settle()
    fireEvent.click(screen.getByTestId('changes-comment-edit'))
    await settle()
    expect(screen.queryByTestId('changes-comment-popover')).toBeNull()
    fireEvent.click(screen.getByTestId('changes-comment-remove'))
    await settle()
    expect(readQuotes(KEY_A).drafts.map((each) => each.id)).toEqual(['c-old'])
    await release()
    const [sent] = calls.filter((call) => call.channel === 'agent.send')
    expect(sent!.input.text).toContain('Why 0.5?')
    expect(readQuotes(KEY_A).pending).toHaveLength(1)
  })

  it('a comment the Session’s own field removes while the Session starts does not go', async () => {
    addDraft(KEY_A, codeComment())
    addDraft(KEY_A, codeComment({ id: 'c-two', startLine: 2, endLine: 2, code: '  discount?: Discount', text: 'Rename it' }))
    await open()
    const release = hold('sessions.start')
    fireEvent.click(screen.getByTestId('changes-tray-send'))
    await settle()
    // The input field of the Session lists the same store and may remove a comment meanwhile.
    act(() => {
      removeDrafts(KEY_A, ['c-two'])
    })
    await release()
    const [sent] = calls.filter((call) => call.channel === 'agent.send')
    expect(sent!.input.text).toContain('Comments on lines of the diff (1)')
    expect(sent!.input.text).not.toContain('Rename it')
  })
})

describe('«To» keeps its Session', () => {
  const flipped = { ...TARGETS, defaultNodeId: 'orchestrator' }

  it('holding comments, it stays when main’s default turns to another Session on a Refresh', async () => {
    addDraft(KEY_A, codeComment())
    await open()
    targets = flipped
    await refresh()
    expect(calls.filter((call) => call.channel === 'changes.targets').length).toBeGreaterThan(1)
    expect(to().textContent).toBe('Session sdk-a')
    expect(screen.getByTestId('changes-tray-count').textContent).toBe('1 comment on 1 file')
  })

  it('with no comments and no Send, it follows main’s default (Q2)', async () => {
    await open()
    targets = flipped
    await refresh()
    expect(to().textContent).toBe('Orchestrator')
  })

  it('a Session that took a Send stays when the list read after the Send names another default', async () => {
    await open()
    fireEvent.change(screen.getByTestId('changes-tray-text'), { target: { value: 'Run the tests.' } })
    targets = flipped
    fireEvent.click(screen.getByTestId('changes-tray-send'))
    await settle()
    await settle()
    expect(calls.filter((call) => call.channel === 'agent.send').map((call) => call.input.sessionId)).toEqual(['sdk-a'])
    expect(calls.filter((call) => call.channel === 'changes.targets').length).toBeGreaterThan(1)
    expect(to().textContent).toBe('Session sdk-a')
  })
})

describe('after a Refresh', () => {
  it('a comment of the scope the Refresh is pressed in moves to its lines', async () => {
    addDraft(KEY_A, codeComment())
    await open()
    fileDiff = () => MOVED_DIFF
    await refresh()
    expect(readQuotes(KEY_A).drafts).toMatchObject([{ id: 'c-old', startLine: 4, endLine: 4 }])
    expect(chipText()).not.toContain('Line changed')
  })

  it('a comment whose lines are shown and gone is marked «Line changed» and stays in the tray', async () => {
    addDraft(KEY_A, codeComment())
    await open()
    fileDiff = () => GONE_DIFF
    await refresh()
    expect(chipText()).toContain('Line changed')
    expect(readQuotes(KEY_A).drafts).toMatchObject([{ id: 'c-old', startLine: 3 }])
  })

  it('a read with the other Hide whitespace does not look for the comments again', async () => {
    addDraft(KEY_A, codeComment())
    await open()
    await refresh()
    fileDiff = (input) => (input.hideWhitespace === true ? GONE_DIFF : CART_DIFF)
    fireEvent.click(screen.getByTestId('changes-hide-whitespace'))
    await settle()
    await settle()
    expect(calls.some((call) => call.channel === 'changes.file' && call.input.hideWhitespace === true)).toBe(true)
    expect(chipText()).not.toContain('Line changed')
  })

  it('a comment on another commit than the read shows on its side stays where it is', async () => {
    addDraft(KEY_A, codeComment({ commit: 'abc1234' }))
    await open()
    fileDiff = () => MOVED_DIFF
    await refresh()
    expect(readQuotes(KEY_A).drafts).toMatchObject([{ id: 'c-old', startLine: 3, commit: 'abc1234' }])
    expect(chipText()).not.toContain('Line changed')
  })

  it('lines the read does not show are not marked «Line changed»', async () => {
    addDraft(KEY_A, codeComment())
    await open()
    fileDiff = () => FAR_DIFF
    await refresh()
    expect(calls.filter((call) => call.channel === 'changes.file').length).toBeGreaterThan(1)
    expect(chipText()).not.toContain('Line changed')
    expect(readQuotes(KEY_A).drafts).toMatchObject([{ id: 'c-old', startLine: 3 }])
  })
})

describe('an open popover', () => {
  it('with text not saved stays when «+» is pressed on another line; an untouched one gives way', async () => {
    toasts.setState({ toasts: [] })
    const asked = () => toasts.getState().toasts.filter((each) => each.key === 'changes-comment-open').length
    await open()
    fireEvent.click(within(row(2)).getByTestId('changes-line-plus'))
    await screen.findByTestId('changes-comment-popover')
    // The key c with the focus out of the popover (it keeps an untouched popover open on a blur) opens it anew.
    fireEvent.keyDown(screen.getByTestId('changes-body'), { key: 'c' })
    await settle()
    expect(asked()).toBe(0)
    fireEvent.click(within(row(3)).getByTestId('changes-line-plus'))
    await settle()
    let popover = screen.getByTestId('changes-comment-popover')
    expect(within(popover).getByTestId('changes-comment-where').textContent).toBe(`${PATH}:3 · new side`)
    fireEvent.change(within(popover).getByTestId('changes-comment-text'), { target: { value: 'Half a thought' } })
    fireEvent.click(within(row(2)).getByTestId('changes-line-plus'))
    await settle()
    popover = screen.getByTestId('changes-comment-popover')
    expect(within(popover).getByTestId('changes-comment-where').textContent).toBe(`${PATH}:3 · new side`)
    expect((within(popover).getByTestId('changes-comment-text') as HTMLTextAreaElement).value).toBe('Half a thought')
    expect(asked()).toBe(1)
  })
})
