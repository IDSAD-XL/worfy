// Comments on the lines of someone else's PR in Review mode (worfy-pr-review ticket 10; src/renderer/pr-review/), over a
// fake preload bridge that answers the channels in the shape main sends them and applies the draft's changes as
// src/main/github/pr-review-draft.ts does:
// - «+» in the gutter and `c` on the lines picked open the popover of the Changes screen (LineComment.tsx); a click with
//   Shift picks a range; ⌘↵ saves the comment into the review draft (`prReview.saveComment`), never to a Session;
// - Suggest change puts a `suggestion` block with the text of the lines picked into the field;
// - a comment stands on its line: «Pending · Edit · Delete», the agent's «Written by the agent · Edit · Delete»; Edit
//   saves with a `ref`, so the comment is the person's from then on; Delete is `prReview.deleteComment`;
// - a comment on a line the diff of the PR lacks stands in «Not on a changed line» above the diff, with Move to line
//   and Delete;
// - the bar: «N pending comments on M files», «(K by the agent)»; Discard asks «Discard N pending comments?» first;
//   Finish review opens the dialog of Submit review (ticket 11), and is inactive while the Session of an Agent review writes;
// - the keys: `c` is not taken in a field the person types in, and is taken from a checkbox; Escape keeps a changed
//   popover and does not close Review mode under it;
// - nothing is written while the draft could not be read, and a Linked machine gets no «+»;
// - the chip `Review draft` of a list row, from `prReview.drafts`.
// Every repository, login, path and text is invented. Nothing here reaches GitHub.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangedFile, FileDiff } from '../../src/shared/changes/types'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrInboxRow } from '../../src/shared/ipc/pr-inbox'
import { UNCONFIRMED, type ReviewComment, type ReviewDraft } from '../../src/shared/ipc/pr-review'

const PROJECT = 'web-00000001'
/** A move of the pointer with its main button held: a drag of «+». */
const PRESSED = { buttons: 1 }
const REPO = 'example-org/web'
const NUMBER = 77
const HEAD = '3f2a9c1e5b7d4a6c8e0f1a2b3c4d5e6f7a8b9c0d'
const BASE = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
const RETRY = 'src/net/retry.ts'

const row = (over: Partial<PrInboxRow> = {}): PrInboxRow => ({
  repo: REPO,
  number: NUMBER,
  title: 'Retry on 429',
  url: `https://github.com/${REPO}/pull/${NUMBER}`,
  isDraft: false,
  author: 'dev-bo',
  headRefName: 'fix/retry-429',
  headRefOid: HEAD,
  baseRefName: 'main',
  baseRefOid: BASE,
  createdAt: '2026-11-19T10:00:00Z',
  updatedAt: '2026-11-20T10:00:00Z',
  ci: 'passing',
  reviewDecision: 'REVIEW_REQUIRED',
  mergeStateStatus: 'BLOCKED',
  additions: 3,
  deletions: 1,
  viaTeam: false,
  unresolvedThreads: 0,
  newSinceSeen: 0,
  lastActivityAt: '2026-11-20T10:00:00Z',
  threads: [],
  comments: [],
  ...over,
})

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  oldPath: null,
  status: 'M',
  additions: 2,
  deletions: 1,
  binary: false,
  oldMode: '100644',
  newMode: '100644',
  oldBlob: `old-${path}`,
  newBlob: `new-${path}`,
  untracked: false,
  workflow: false,
  fold: null,
  ...over,
})

const FILES = [file(RETRY), file('src/net/backoff.ts', { status: 'A', oldBlob: null, oldMode: null, additions: 1, deletions: 0 })]

const hunks = (path: string): FileDiff => ({
  kind: 'hunks',
  path,
  oldPath: null,
  oldMode: null,
  newMode: null,
  whole: false,
  hunks: [
    {
      header: '@@ -1,2 +1,3 @@',
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
      section: '',
      lines: [
        { kind: 'context', text: 'const MAX = 3', oldLine: 1, newLine: 1, crlf: false, noNewline: false },
        { kind: 'del', text: 'const WAIT = 100', oldLine: 2, newLine: null, crlf: false, noNewline: false },
        { kind: 'add', text: 'const WAIT = [100, 400]', oldLine: null, newLine: 2, crlf: false, noNewline: false },
        { kind: 'add', text: 'const JITTER = 0.1', oldLine: null, newLine: 3, crlf: false, noNewline: false },
      ],
    },
  ],
})

/** retry.ts with a second hunk, new lines 19–21: a range from line 3 to line 20 crosses hunks. */
const twoHunks = (path: string): FileDiff => {
  const first = hunks(path) as Extract<FileDiff, { kind: 'hunks' }>
  return {
    ...first,
    hunks: [
      ...first.hunks,
      {
        header: '@@ -18,2 +19,3 @@',
        oldStart: 18,
        oldLines: 2,
        newStart: 19,
        newLines: 3,
        section: '',
        lines: [
          { kind: 'context', text: 'export function retry() {', oldLine: 18, newLine: 19, crlf: false, noNewline: false },
          { kind: 'del', text: '  return once()', oldLine: 19, newLine: null, crlf: false, noNewline: false },
          { kind: 'add', text: '  return withBackoff()', oldLine: null, newLine: 20, crlf: false, noNewline: false },
          { kind: 'add', text: '  // capped', oldLine: null, newLine: 21, crlf: false, noNewline: false },
        ],
      },
    ],
  }
}

const draftOf = (over: Partial<ReviewDraft> = {}): ReviewDraft => ({ schema: 1, repo: REPO, pr: NUMBER, startedOn: HEAD, payload: { body: '', comments: [] }, anchors: [], viewed: {}, state: 'draft', ...over })
const on = (line: number, body: string, path = RETRY): ReviewComment => ({ path, line, side: 'RIGHT', body })
const withComments = (comments: { comment: ReviewComment; by: 'person' | 'agent' }[], over: Partial<ReviewDraft> = {}): ReviewDraft =>
  draftOf({ payload: { body: '', comments: comments.map((each) => each.comment) }, anchors: comments.map((each) => ({ text: 'x', by: each.by })), ...over })

interface Fake {
  calls: { channel: string; input: Record<string, unknown> }[]
  draft: ReviewDraft | null
}

let main: Fake

type Answers = Record<string, (input: Record<string, unknown>) => IpcResult<unknown>>

function preload(start: { draft?: ReviewDraft | null; answers?: Answers } = {}): void {
  const fake: Fake = { calls: [], draft: start.draft ?? null }
  const draftAnswer = () => ({ ok: true as const, value: { repo: REPO, pr: NUMBER, draft: fake.draft, problem: null } })
  /** The comment a `ref` names, as main finds it: of its file, with its text, the nearest to its place. */
  const locate = (ref: { index: number; path: string; body: string }): number => {
    let found = -1
    fake.draft!.payload.comments.forEach((comment, index) => {
      if (comment.path === ref.path && comment.body === ref.body && (found === -1 || Math.abs(index - ref.index) < Math.abs(found - ref.index))) found = index
    })
    return found
  }
  const answer = (channel: string, input: Record<string, unknown>): IpcResult<unknown> => {
    const own = start.answers?.[channel]
    if (own !== undefined) return own(input)
    switch (channel) {
      case 'changes.list':
        return { ok: true, value: { repos: [{ repo: REPO, kind: 'pr', branch: `#${NUMBER}`, scope: (input.scope as { kind: string }).kind, base: null, headSha: HEAD, workTree: false, files: FILES, additions: 3, deletions: 1, error: null, source: 'github', truncatedAt: null }] } }
      case 'changes.file':
        return { ok: true, value: { file: hunks(input.path as string) } }
      case 'changes.commits':
        return { ok: true, value: { base: null, commits: [] } }
      case 'prReview.draft':
        return draftAnswer()
      case 'prReview.start':
        fake.draft ??= draftOf({ startedOn: input.head as string })
        return draftAnswer()
      case 'prReview.saveComment': {
        const draft = structuredClone(fake.draft ?? draftOf({ startedOn: input.head as string }))
        fake.draft = draft
        const ref = input.ref as { index: number; path: string; body: string } | undefined
        // putComment's check: the anchor has exactly the lines the comment covers.
        const { line: last, start_line: first } = input.comment as ReviewComment
        const size = last - (first ?? last) + 1
        const lines = (input.anchor as string).split(/\r?\n/u)
        const count = lines.length === size + 1 && lines.at(-1) === '' ? size : lines.length
        if (count !== size) return { ok: false, error: `The text of the commented lines has ${count} lines, the comment covers ${size} lines` }
        const anchor = { text: input.anchor as string, by: 'person' as const }
        if (ref === undefined) {
          draft.payload.comments.push(input.comment as ReviewComment)
          draft.anchors.push(anchor)
        } else {
          const index = locate(ref)
          if (index < 0) return { ok: false, error: 'The comment changed meanwhile' }
          draft.payload.comments[index] = input.comment as ReviewComment
          draft.anchors[index] = anchor
        }
        return draftAnswer()
      }
      case 'prReview.deleteComment': {
        const draft = structuredClone(fake.draft!)
        fake.draft = draft
        const index = locate(input.ref as { index: number; path: string; body: string })
        draft.payload.comments.splice(index, 1)
        draft.anchors.splice(index, 1)
        return draftAnswer()
      }
      case 'prReview.discard':
        fake.draft = null
        return draftAnswer()
      case 'prReview.drafts':
        return { ok: true, value: { drafts: fake.draft === null ? [] : [{ repo: REPO, pr: NUMBER, comments: fake.draft.payload.comments.length, startedOn: fake.draft.startedOn, state: fake.draft.state }], problem: null } }
      default:
        return { ok: true, value: null }
    }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input: input as Record<string, unknown> })
      return Promise.resolve(answer(channel, input as Record<string, unknown>) as never)
    },
    on: () => 0,
    off: () => undefined,
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

const calls = (channel: string): Record<string, unknown>[] => main.calls.filter((call) => call.channel === channel).map((call) => call.input)
/** The channels that change the draft. */
const writes = (): string[] => main.calls.map((call) => call.channel).filter((channel) => ['prReview.saveComment', 'prReview.deleteComment', 'prReview.discard', 'prReview.setViewed'].includes(channel))

beforeEach(() => {
  vi.resetModules()
  globalThis.localStorage.clear()
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 20))
  })

/** Review mode on the PR, opened as Start review opens it, its draft in place and the lines of retry.ts drawn. */
async function mountReview(options: { how?: 'myself' | 'agent'; readOnly?: string | null; draftless?: boolean } = {}) {
  const mode = { ...(await import('../../src/renderer/pr-review/ReviewMode')), ...(await import('../../src/renderer/pr-review/review-store')) }
  const readOnly = options.readOnly ?? null
  mode.openReviewMode({ projectId: PROJECT, repo: REPO, number: NUMBER }, options.how ?? 'myself', readOnly !== null)
  const view = render(<mode.ReviewMode projectId={PROJECT} row={row()} readOnly={readOnly} onRefresh={vi.fn()} />)
  await waitFor(() => expect(screen.getAllByTestId('changes-tree-file')).toHaveLength(2))
  await screen.findAllByTestId('changes-line')
  if (readOnly === null && options.draftless !== true) await waitFor(() => expect(screen.getByTestId('pr-review-bar')).toBeTruthy())
  await settle()
  return { mode, view }
}

/** The row of a line of retry.ts, the new side by default. */
const line = (number: number, side: 'old' | 'new' = 'new', path = RETRY): HTMLElement =>
  screen.getAllByTestId('changes-line').find((each) => each.dataset.side === side && each.dataset.line === String(number) && each.closest<HTMLElement>('[data-testid="changes-hunk"]')?.dataset.path === path)!
const popover = (): HTMLElement => screen.getByTestId('changes-comment-popover')
const field = (): HTMLTextAreaElement => within(popover()).getByTestId('changes-comment-text') as HTMLTextAreaElement
/** ⌘↵: the document of the test is a Mac's (`data-platform="mac"`). */
const saveKey = () => fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })
const boxes = (): HTMLElement[] => screen.queryAllByTestId('pr-review-comment')

describe('a comment on a line of the PR', () => {
  it('«+» opens the popover on its line; ⌘↵ saves it into the review draft on the commit shown; it stands on the line, Pending, with Edit and Delete', async () => {
    preload()
    await mountReview()
    fireEvent.click(within(line(2)).getByTestId('changes-line-plus'))
    expect(within(await screen.findByTestId('changes-comment-popover')).getByTestId('changes-comment-where').textContent).toBe(`${RETRY}:2 · new side`)
    expect(within(popover()).getByTestId('changes-comment-code').textContent).toBe('const WAIT = [100, 400]')
    // Images do not go to GitHub in a review comment: no Add image here.
    expect(within(popover()).queryByTestId('changes-comment-add-image')).toBeNull()
    fireEvent.change(field(), { target: { value: '  Should this read Retry-After first?  ' } })
    saveKey()
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(1))
    expect(calls('prReview.saveComment')[0]).toEqual({ projectId: PROJECT, repo: REPO, number: NUMBER, head: HEAD, comment: { path: RETRY, line: 2, side: 'RIGHT', body: 'Should this read Retry-After first?' }, anchor: 'const WAIT = [100, 400]' })
    await waitFor(() => expect(screen.queryByTestId('changes-comment-popover')).toBeNull())
    // Under its line, the person's: Pending, Edit and Delete.
    const box = (await screen.findAllByTestId('pr-review-comment'))[0]!
    expect(box.dataset.by).toBe('person')
    expect(box.textContent).toContain('Pending')
    expect(box.textContent).toContain('Should this read Retry-After first?')
    expect(line(2).parentElement!.contains(box) || box.compareDocumentPosition(line(2)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(within(box).getByTestId('pr-review-comment-edit').textContent).toBe('Edit')
    expect(within(box).getByTestId('pr-review-comment-delete').textContent).toBe('Delete')
    // Never to a Session: the comments of Changes go there, these do not.
    expect(main.calls.some((call) => call.channel.startsWith('agent.') || call.channel.startsWith('sessions.') || call.channel === 'changes.targets')).toBe(false)
  })

  it('the old side is LEFT; a click with Shift picks a range and `c` comments on it, with start_line and start_side', async () => {
    preload()
    await mountReview()
    fireEvent.click(within(line(2, 'old')).getByTestId('changes-line-plus'))
    await screen.findByTestId('changes-comment-popover')
    fireEvent.change(field(), { target: { value: 'Why was it 100?' } })
    fireEvent.click(within(popover()).getByTestId('changes-comment-save'))
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(1))
    expect(calls('prReview.saveComment')[0]!.comment).toEqual({ path: RETRY, line: 2, side: 'LEFT', body: 'Why was it 100?' })
    await waitFor(() => expect(screen.queryByTestId('changes-comment-popover')).toBeNull())

    fireEvent.click(line(2).querySelector('.w-changes__code')!)
    fireEvent.click(line(3).querySelector('.w-changes__code')!, { shiftKey: true })
    expect(line(2).classList.contains('is-picked') && line(3).classList.contains('is-picked')).toBe(true)
    fireEvent.keyDown(document.body, { key: 'c' })
    expect(within(await screen.findByTestId('changes-comment-popover')).getByTestId('changes-comment-where').textContent).toBe(`${RETRY}:2–3 · new side`)
    fireEvent.change(field(), { target: { value: 'One block' } })
    saveKey()
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(2))
    expect(calls('prReview.saveComment')[1]).toMatchObject({ comment: { path: RETRY, line: 3, side: 'RIGHT', start_line: 2, start_side: 'RIGHT', body: 'One block' }, anchor: 'const WAIT = [100, 400]\nconst JITTER = 0.1' })
  })

  it('Suggest change puts a `suggestion` block with the text of the lines picked into the field, after what is typed', async () => {
    preload()
    await mountReview()
    fireEvent.click(line(2).querySelector('.w-changes__code')!)
    fireEvent.click(line(3).querySelector('.w-changes__code')!, { shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'c' })
    await screen.findByTestId('changes-comment-popover')
    fireEvent.click(within(popover()).getByTestId('changes-comment-suggest'))
    expect(field().value).toBe('```suggestion\nconst WAIT = [100, 400]\nconst JITTER = 0.1\n```')
    fireEvent.change(field(), { target: { value: 'Shorter:' } })
    fireEvent.click(within(popover()).getByTestId('changes-comment-suggest'))
    expect(field().value).toBe('Shorter:\n\n```suggestion\nconst WAIT = [100, 400]\nconst JITTER = 0.1\n```')
  })

  it('`c` is not taken in a field the person types in, and is taken from a checkbox (Viewed)', async () => {
    preload()
    await mountReview()
    fireEvent.click(line(3).querySelector('.w-changes__code')!)
    fireEvent.keyDown(screen.getByTestId('changes-filter'), { key: 'c' })
    expect(screen.queryByTestId('changes-comment-popover')).toBeNull()
    const viewed = screen.getAllByTestId('pr-review-viewed')[0]!
    fireEvent.keyDown(viewed, { key: 'c' })
    expect(within(await screen.findByTestId('changes-comment-popover')).getByTestId('changes-comment-where').textContent).toBe(`${RETRY}:3 · new side`)
  })

  // worfy-changes-view ticket 09 (D2): the range is picked as on GitHub, by dragging «+», and a hint says how to comment.
  it('dragging «+» over lines picks a range and opens the popover on it; the hint «Comment on lines N–M (c)» opens it too; Escape takes the pick first', async () => {
    preload()
    const { mode } = await mountReview()
    fireEvent.mouseDown(within(line(1)).getByTestId('changes-line-plus'))
    fireEvent.mouseMove(line(2).querySelector('.w-changes__code')!, PRESSED)
    fireEvent.mouseMove(line(3).querySelector('.w-changes__code')!, PRESSED)
    fireEvent.mouseUp(line(3).querySelector('.w-changes__code')!)
    expect(within(await screen.findByTestId('changes-comment-popover')).getByTestId('changes-comment-where').textContent).toBe(`${RETRY}:1–3 · new side`)
    // While the popover is open the hint stands aside.
    expect(screen.queryByTestId('changes-pick-hint')).toBeNull()
    fireEvent.click(within(popover()).getByTestId('changes-comment-cancel'))
    await waitFor(() => expect(screen.queryByTestId('changes-comment-popover')).toBeNull())

    const hint = screen.getByTestId('changes-pick-hint')
    expect(hint.textContent).toBe('Comment on lines 1–3 (c)')
    // Under the last line picked.
    expect(line(3).compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(line(2).compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(hint)
    expect(within(await screen.findByTestId('changes-comment-popover')).getByTestId('changes-comment-where').textContent).toBe(`${RETRY}:1–3 · new side`)
    fireEvent.change(field(), { target: { value: 'One block' } })
    saveKey()
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(1))
    expect(calls('prReview.saveComment')[0]).toMatchObject({ comment: { path: RETRY, line: 3, side: 'RIGHT', start_line: 1, start_side: 'RIGHT', body: 'One block' } })
    await waitFor(() => expect(screen.queryByTestId('changes-comment-popover')).toBeNull())

    // Shift with «+» stretches a pick without a popover; Escape takes the pick away and leaves Review mode open, the next closes it.
    fireEvent.click(line(1).querySelector('.w-changes__code')!)
    fireEvent.mouseDown(within(line(2)).getByTestId('changes-line-plus'), { shiftKey: true })
    expect(screen.queryByTestId('changes-comment-popover')).toBeNull()
    expect(screen.getByTestId('changes-pick-hint').textContent).toBe('Comment on lines 1–2 (c)')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('changes-pick-hint')).toBeNull()
    expect(mode.useReviewMode.getState().open).not.toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(mode.useReviewMode.getState().open).toBeNull()
  })

  it('Escape keeps a changed popover and does not close Review mode under it; on an unchanged one it closes the popover only', async () => {
    preload()
    const { mode } = await mountReview()
    fireEvent.click(within(line(2)).getByTestId('changes-line-plus'))
    await screen.findByTestId('changes-comment-popover')
    fireEvent.change(field(), { target: { value: 'Keep me' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    await settle()
    expect(field().value).toBe('Keep me')
    expect(mode.useReviewMode.getState().open).not.toBeNull()
    fireEvent.change(field(), { target: { value: '' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('changes-comment-popover')).toBeNull())
    expect(mode.useReviewMode.getState().open).not.toBeNull()
    expect(calls('prReview.saveComment')).toEqual([])
  })
})

describe('the comments of the draft', () => {
  it('the agent\'s: «Written by the agent»; Edit saves it with its ref and it is the person\'s from then on; Delete removes it', async () => {
    preload({ draft: withComments([{ comment: on(3, 'Jitter of 0.1 is a guess.'), by: 'agent' }, { comment: on(1, 'Why three?'), by: 'person' }], { agent: { sessionId: 's-1', state: 'done' } }) })
    await mountReview({ how: 'agent' })
    await waitFor(() => expect(boxes()).toHaveLength(2))
    const agent = boxes().find((box) => box.dataset.by === 'agent')!
    expect(agent.textContent).toContain('Written by the agent')
    expect(agent.textContent).not.toContain('Pending')
    fireEvent.click(within(agent).getByTestId('pr-review-comment-edit'))
    await screen.findByTestId('changes-comment-popover')
    expect(field().value).toBe('Jitter of 0.1 is a guess.')
    fireEvent.change(field(), { target: { value: 'Jitter of 0.1 is a guess: name the source.' } })
    saveKey()
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(1))
    expect(calls('prReview.saveComment')[0]).toEqual({
      projectId: PROJECT,
      repo: REPO,
      number: NUMBER,
      head: HEAD,
      ref: { index: 0, path: RETRY, body: 'Jitter of 0.1 is a guess.' },
      comment: { path: RETRY, line: 3, side: 'RIGHT', body: 'Jitter of 0.1 is a guess: name the source.' },
      anchor: 'x',
    })
    await waitFor(() => expect(boxes().every((box) => box.dataset.by === 'person')).toBe(true))
    const edited = boxes().find((box) => box.textContent?.includes('name the source'))!
    expect(edited.textContent).toContain('Pending')

    fireEvent.click(within(boxes().find((box) => box.textContent?.includes('Why three?'))!).getByTestId('pr-review-comment-delete'))
    await waitFor(() => expect(calls('prReview.deleteComment')).toHaveLength(1))
    expect(calls('prReview.deleteComment')[0]).toEqual({ projectId: PROJECT, repo: REPO, number: NUMBER, ref: { index: 1, path: RETRY, body: 'Why three?' } })
    await waitFor(() => expect(boxes()).toHaveLength(1))
  })

  it('a comment on a line the diff lacks: «Not on a changed line» above the diff, not on a line; Move to line puts it on the line picked; Delete removes it', async () => {
    preload({ draft: withComments([{ comment: on(40, 'The client retries too.'), by: 'agent' }, { comment: on(5, 'Gone file.', 'src/net/client.ts'), by: 'agent' }, { comment: on(2, 'On its line.'), by: 'person' }]) })
    await mountReview()
    const off = await screen.findByTestId('pr-review-not-on-line')
    await waitFor(() => expect(within(off).getAllByTestId('pr-review-comment')).toHaveLength(2))
    expect(off.textContent).toContain('Not on a changed line')
    expect(within(off).getAllByTestId('pr-review-comment').map((box) => box.textContent?.includes(`${RETRY}:40`) || box.textContent?.includes('src/net/client.ts:5'))).toEqual([true, true])
    // The one on a changed line is not in the list.
    expect(off.textContent).not.toContain('On its line.')
    const first = within(off).getAllByTestId('pr-review-comment')[0]!
    fireEvent.click(within(first).getByTestId('pr-review-comment-move'))
    expect(screen.getByTestId('pr-review-moving').textContent).toContain('Click a changed line')
    fireEvent.click(within(line(3)).getByTestId('changes-line-plus'))
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(1))
    expect(calls('prReview.saveComment')[0]).toEqual({
      projectId: PROJECT,
      repo: REPO,
      number: NUMBER,
      head: HEAD,
      ref: { index: 0, path: RETRY, body: 'The client retries too.' },
      comment: { path: RETRY, line: 3, side: 'RIGHT', body: 'The client retries too.' },
      anchor: 'const JITTER = 0.1',
    })
    expect(screen.queryByTestId('changes-comment-popover')).toBeNull()
    await waitFor(() => expect(within(screen.getByTestId('pr-review-not-on-line')).getAllByTestId('pr-review-comment')).toHaveLength(1))
    fireEvent.click(within(within(screen.getByTestId('pr-review-not-on-line')).getByTestId('pr-review-comment')).getByTestId('pr-review-comment-delete'))
    await waitFor(() => expect(calls('prReview.deleteComment')).toHaveLength(1))
    expect(calls('prReview.deleteComment')[0]!.ref).toEqual({ index: 1, path: 'src/net/client.ts', body: 'Gone file.' })
    await waitFor(() => expect(screen.queryByTestId('pr-review-not-on-line')).toBeNull())
  })
})

describe('the lines a comment stands on', () => {
  const toastTexts = async (): Promise<string[]> => (await import('../../src/renderer/toast/toasts')).toasts.getState().toasts.map((toast) => toast.text)
  const withAnchors = (comments: { comment: ReviewComment; by: 'person' | 'agent'; text: string }[], over: Partial<ReviewDraft> = {}): ReviewDraft =>
    draftOf({ payload: { body: '', comments: comments.map((each) => each.comment) }, anchors: comments.map(({ text, by }) => ({ text, by })), ...over })

  it('a folded file (lock, generated, too large) is read whole: its comment on a changed line is neither «Not on a changed line» nor left out of «on M files»', async () => {
    const BACKOFF = 'src/net/backoff.ts'
    preload({
      draft: withComments([{ comment: on(2, 'A.', BACKOFF), by: 'person' }]),
      answers: { 'changes.file': (input) => ({ ok: true, value: { file: input.path === BACKOFF && input.expand !== true ? { kind: 'folded', path: BACKOFF, reason: 'lock', lines: 9000 } : hunks(input.path as string) } }) },
    })
    await mountReview()
    await waitFor(() => expect(calls('changes.file').some((input) => input.path === BACKOFF && input.expand === true && input.hideWhitespace === false)).toBe(true))
    await settle()
    expect(screen.queryByTestId('pr-review-not-on-line')).toBeNull()
    expect(screen.getByTestId('pr-review-bar-count').textContent).toBe('1 pending comment on 1 file')
  })

  it('Hide whitespace: «+» on a file not read for comments yet reads it without -w and opens the popover, not nothing', async () => {
    preload()
    await mountReview()
    fireEvent.click(screen.getByLabelText('Hide whitespace'))
    // Refresh drops what was read before: the diff is read again with -w only.
    fireEvent.click(screen.getByTestId('pr-review-refresh'))
    await settle()
    await screen.findAllByTestId('changes-line')
    const before = calls('changes.file').length
    fireEvent.click(within(line(2)).getByTestId('changes-line-plus'))
    expect(within(await screen.findByTestId('changes-comment-popover')).getByTestId('changes-comment-code').textContent).toBe('const WAIT = [100, 400]')
    expect(calls('changes.file').slice(before).some((input) => input.path === RETRY && input.hideWhitespace === false)).toBe(true)
  })

  it('Edit of the agent\'s range whose stored text is empty sends the text of its lines from the diff, and main takes it', async () => {
    const range: ReviewComment = { path: RETRY, start_line: 2, start_side: 'RIGHT', line: 3, side: 'RIGHT', body: 'Two lines.' }
    preload({ draft: withAnchors([{ comment: range, by: 'agent', text: '' }], { agent: { sessionId: 's-1', state: 'done' } }) })
    await mountReview({ how: 'agent' })
    fireEvent.click(within((await screen.findAllByTestId('pr-review-comment'))[0]!).getByTestId('pr-review-comment-edit'))
    await screen.findByTestId('changes-comment-popover')
    fireEvent.change(field(), { target: { value: 'Two lines, both new.' } })
    saveKey()
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(1))
    expect(calls('prReview.saveComment')[0]!.anchor).toBe('const WAIT = [100, 400]\nconst JITTER = 0.1')
    await waitFor(() => expect(boxes().map((box) => box.dataset.by)).toEqual(['person']))
  })

  it('Edit of the agent\'s range off the diff with no stored text sends empty lines as many as it covers, and main takes it', async () => {
    const range: ReviewComment = { path: RETRY, start_line: 40, start_side: 'RIGHT', line: 41, side: 'RIGHT', body: 'Off.' }
    preload({ draft: withAnchors([{ comment: range, by: 'agent', text: '' }], { agent: { sessionId: 's-1', state: 'done' } }) })
    await mountReview({ how: 'agent' })
    const off = await screen.findByTestId('pr-review-not-on-line')
    fireEvent.click(within(await within(off).findByTestId('pr-review-comment')).getByTestId('pr-review-comment-edit'))
    await screen.findByTestId('changes-comment-popover')
    fireEvent.change(field(), { target: { value: 'Off, edited.' } })
    saveKey()
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(1))
    expect(calls('prReview.saveComment')[0]!.anchor).toBe('\n')
    await waitFor(() => expect(boxes().map((box) => box.dataset.by)).toEqual(['person']))
  })

  it('Edit keeps the lines it was opened on: a comment deleted meanwhile does not pair it with a neighbour\'s text', async () => {
    preload({
      draft: withAnchors([
        { comment: on(1, 'One.'), by: 'person', text: 'const MAX = 3' },
        { comment: on(2, 'Two.'), by: 'person', text: 'const WAIT = [100, 400]' },
        { comment: on(3, 'Three.'), by: 'person', text: 'const JITTER = 0.1' },
      ]),
    })
    await mountReview()
    await waitFor(() => expect(boxes()).toHaveLength(3))
    fireEvent.click(within(boxes().find((box) => box.textContent?.includes('Two.'))!).getByTestId('pr-review-comment-edit'))
    await screen.findByTestId('changes-comment-popover')
    fireEvent.change(field(), { target: { value: 'Two, edited.' } })
    fireEvent.click(within(boxes().find((box) => box.textContent?.includes('One.'))!).getByTestId('pr-review-comment-delete'))
    await waitFor(() => expect(boxes()).toHaveLength(2))
    saveKey()
    await waitFor(() => expect(calls('prReview.saveComment')).toHaveLength(1))
    expect(calls('prReview.saveComment')[0]).toMatchObject({ comment: on(2, 'Two, edited.'), anchor: 'const WAIT = [100, 400]' })
  })

  it('Suggest change is offered on the new side only', async () => {
    preload()
    await mountReview()
    fireEvent.click(within(line(2, 'old')).getByTestId('changes-line-plus'))
    await screen.findByTestId('changes-comment-popover')
    expect(within(popover()).queryByTestId('changes-comment-suggest')).toBeNull()
  })

  it('a person\'s save and Delete tell the lists of drafts to read again (the chip Review draft)', async () => {
    preload()
    await mountReview()
    const store = await import('../../src/renderer/pr-review/review-store')
    function Probe() {
      store.useReviewDrafts(PROJECT)
      return null
    }
    render(<Probe />)
    await waitFor(() => expect(calls('prReview.drafts').length).toBeGreaterThan(0))
    await settle()
    const read = calls('prReview.drafts').length
    fireEvent.click(within(line(2)).getByTestId('changes-line-plus'))
    await screen.findByTestId('changes-comment-popover')
    fireEvent.change(field(), { target: { value: 'A.' } })
    saveKey()
    await waitFor(() => expect(calls('prReview.drafts')).toHaveLength(read + 1))
    fireEvent.click(within((await screen.findAllByTestId('pr-review-comment'))[0]!).getByTestId('pr-review-comment-delete'))
    await waitFor(() => expect(calls('prReview.drafts')).toHaveLength(read + 2))
  })

  it('an agent\'s range across hunks is «Not on a changed line» (GitHub: start_line must be in the hunk of line); a range in one hunk stands on its line', async () => {
    preload({
      draft: withComments([
        { comment: { path: RETRY, start_line: 3, start_side: 'RIGHT', line: 20, side: 'RIGHT', body: 'Across.' }, by: 'agent' },
        { comment: { path: RETRY, start_line: 2, start_side: 'RIGHT', line: 3, side: 'RIGHT', body: 'Within.' }, by: 'agent' },
      ]),
      answers: { 'changes.file': (input) => ({ ok: true, value: { file: input.path === RETRY ? twoHunks(RETRY) : hunks(input.path as string) } }) },
    })
    await mountReview()
    const off = await screen.findByTestId('pr-review-not-on-line')
    await waitFor(() => expect(within(off).getAllByTestId('pr-review-comment').map((box) => box.textContent?.includes('Across.'))).toEqual([true]))
    expect(off.textContent).not.toContain('Within.')
  })

  // Review round 3 of worfy-changes-view 09: a click with Shift or Shift with «+» on a line of another hunk picked across
  // hunks, the hint promised that range, and `c` refused it. A pick now stays in the hunk it began in.
  it('a click with Shift or Shift with «+» on a line of another hunk picks that line alone; `c` opens it, with no refusal', async () => {
    preload({ answers: { 'changes.file': (input) => ({ ok: true, value: { file: input.path === RETRY ? twoHunks(RETRY) : hunks(input.path as string) } }) } })
    await mountReview()
    fireEvent.click(line(3).querySelector('.w-changes__code')!)
    fireEvent.click(line(20).querySelector('.w-changes__code')!, { shiftKey: true })
    expect(screen.getByTestId('changes-pick-hint').textContent).toBe('Comment on line 20 (c)')
    fireEvent.click(line(2).querySelector('.w-changes__code')!)
    fireEvent.mouseDown(within(line(21)).getByTestId('changes-line-plus'), { shiftKey: true })
    expect(screen.getByTestId('changes-pick-hint').textContent).toBe('Comment on line 21 (c)')
    fireEvent.mouseDown(within(line(20)).getByTestId('changes-line-plus'), { shiftKey: true })
    expect(screen.getByTestId('changes-pick-hint').textContent).toBe('Comment on lines 20–21 (c)')
    fireEvent.keyDown(document.body, { key: 'c' })
    expect(within(await screen.findByTestId('changes-comment-popover')).getByTestId('changes-comment-where').textContent).toBe(`${RETRY}:20–21 · new side`)
    expect(await toastTexts()).not.toContain('A comment covers lines of one hunk: GitHub refuses a range across hunks. Pick lines of one hunk.')
    expect(writes()).toEqual([])
  })
})

describe('the bar Your review', () => {
  it('«N pending comments on M files», «(K by the agent)»; Finish review opens the dialog of Submit review, ⌘⇧↵ too', async () => {
    preload({ draft: withComments([{ comment: on(2, 'A.'), by: 'person' }, { comment: on(1, 'B.', 'src/net/backoff.ts'), by: 'person' }]) })
    await mountReview()
    await waitFor(() => expect(screen.getByTestId('pr-review-bar-count').textContent).toBe('2 pending comments on 2 files'))
    const finish = screen.getByTestId('pr-review-finish')
    expect(finish.getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(finish)
    const dialog = await screen.findByTestId('pr-review-finish-dialog')
    expect(within(dialog).getAllByTestId('pr-review-dialog-comment')).toHaveLength(2)
    fireEvent.click(within(dialog).getByTestId('pr-review-dialog-cancel'))
    await waitFor(() => expect(screen.queryByTestId('pr-review-finish-dialog')).toBeNull())
    fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true, shiftKey: true })
    await screen.findByTestId('pr-review-finish-dialog')
    expect(calls('prReview.submit')).toEqual([])
    cleanup()
    preload({ draft: withComments([{ comment: on(2, 'A.'), by: 'agent' }, { comment: on(3, 'B.'), by: 'person' }], { agent: { sessionId: 's-1', state: 'done' } }) })
    await mountReview({ how: 'agent' })
    await waitFor(() => expect(screen.getByTestId('pr-review-bar-count').textContent).toBe('2 comments (1 by the agent) on 1 file'))
  })

  it('Submit review that GitHub took: a toast, the PR read again, Review mode closes; the commit is the one the draft is numbered on', async () => {
    const anchored = '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b'
    const draft = withComments([{ comment: on(2, 'A.'), by: 'person' }], { anchoredOn: anchored })
    preload({
      draft,
      answers: {
        'prReview.check': () => ({ ok: true, value: { findings: [], reason: null } }),
        'prReview.submit': () => ({ ok: true, value: { outcome: 'submitted', reason: null, reviewUrl: `https://github.com/${REPO}/pull/${NUMBER}#pullrequestreview-1`, head: null, draft: { ...draft, state: 'submitted' } } }),
      },
    })
    const mode = { ...(await import('../../src/renderer/pr-review/ReviewMode')), ...(await import('../../src/renderer/pr-review/review-store')) }
    mode.openReviewMode({ projectId: PROJECT, repo: REPO, number: NUMBER }, 'myself', false)
    const onRefresh = vi.fn()
    render(<mode.ReviewMode projectId={PROJECT} row={row({ headRefOid: anchored })} readOnly={null} onRefresh={onRefresh} viewer="dev-me" />)
    fireEvent.click(await screen.findByTestId('pr-review-finish'))
    const dialog = await screen.findByTestId('pr-review-finish-dialog')
    await waitFor(() => expect(calls('prReview.check').length).toBeGreaterThan(0))
    onRefresh.mockClear()
    fireEvent.click(within(dialog).getByTestId('pr-review-submit'))
    await waitFor(() => expect(mode.useReviewMode.getState().open).toBeNull())
    expect(calls('prReview.submit')).toEqual([{ projectId: PROJECT, repo: REPO, number: NUMBER, event: 'COMMENT', body: '', comments: [on(2, 'A.')], commit: anchored, head: anchored }])
    expect(onRefresh).toHaveBeenCalled()
    const toasts = (await import('../../src/renderer/toast/toasts')).toasts.getState().toasts.map((toast) => toast.text)
    expect(toasts).toContain(`Review sent to ${REPO}#${NUMBER} · Comment · 1 comment`)
  })

  it('a submitted review: the bar says so with its link and offers Start a new review, no Finish review', async () => {
    preload({ draft: withComments([{ comment: on(2, 'A.'), by: 'person' }], { state: 'submitted', payload: { event: 'APPROVE', body: '', comments: [on(2, 'A.')] }, reviewUrl: 'https://github.com/example-org/web/pull/77#pullrequestreview-1' }) })
    await mountReview()
    const bar = screen.getByTestId('pr-review-bar')
    expect(bar.dataset.state).toBe('submitted')
    expect(bar.textContent).toContain('You reviewed this pull request · Approve')
    expect(within(bar).getByTestId('pr-review-open-review').getAttribute('href')).toBe('https://github.com/example-org/web/pull/77#pullrequestreview-1')
    expect(within(bar).queryByTestId('pr-review-finish')).toBeNull()
    // Its comments are on GitHub: not Pending any more.
    const posted = await screen.findByTestId('pr-review-comment')
    expect(posted.textContent).toContain('Submitted')
    expect(posted.textContent).toContain('on GitHub')
    expect(posted.textContent).not.toContain('Pending')
    expect(posted.textContent).not.toContain('not on GitHub yet')
    fireEvent.click(within(bar).getByTestId('pr-review-new'))
    await waitFor(() => expect(calls('prReview.discard')).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('pr-review-bar').dataset.state).toBe('person'))
  })

  it('the reason a Submit failed stays on the bar', async () => {
    preload({ draft: withComments([{ comment: on(2, 'A.'), by: 'person' }], { error: 'GitHub did not confirm the review: gh: Server Error (HTTP 502)' }) })
    await mountReview()
    expect(screen.getByTestId('pr-review-bar-error').textContent).toBe('GitHub did not confirm the review: gh: Server Error (HTTP 502)')
  })

  it('Discard of a draft whose Submit GitHub did not confirm warns that the review may be on GitHub already', async () => {
    preload({ draft: withComments([], { error: `${UNCONFIRMED}: gh: Not Found (HTTP 404)`, payload: { event: 'APPROVE', body: 'Ship it.', comments: [] } }) })
    await mountReview()
    const discard = screen.getByTestId('pr-review-discard')
    expect(discard.hasAttribute('disabled')).toBe(false)
    fireEvent.click(discard)
    const ask = await screen.findByTestId('pr-review-discard-confirm')
    expect(within(ask).getByRole('heading').textContent).toBe('Discard this review?')
    expect(within(ask).getByTestId('pr-review-discard-text').textContent).toContain('may be on GitHub already')
    fireEvent.click(within(ask).getByTestId('pr-review-discard-ok'))
    await waitFor(() => expect(calls('prReview.discard')).toEqual([{ projectId: PROJECT, repo: REPO, number: NUMBER }]))
  })

  it('a draft whose Submit GitHub did not confirm keeps the texts that went: no Edit, no Delete, no «+», no agent; Finish review submits them again', async () => {
    preload({ draft: withComments([{ comment: on(2, 'A.'), by: 'person' }], { error: `${UNCONFIRMED}: gh: Server Error (HTTP 502)` }) })
    await mountReview()
    const bar = screen.getByTestId('pr-review-bar')
    expect(bar.dataset.state).toBe('unconfirmed')
    expect(screen.getByTestId('pr-review-bar-count').textContent).toContain('worfy first looks whether GitHub has it already')
    const shown = await screen.findByTestId('pr-review-comment')
    expect(within(shown).queryByTestId('pr-review-comment-edit')).toBeNull()
    expect(within(shown).queryByTestId('pr-review-comment-delete')).toBeNull()
    expect(screen.queryByTestId('changes-line-plus')).toBeNull()
    expect(within(bar).queryByTestId('pr-review-ask-agent')).toBeNull()
    expect(within(bar).queryByTestId('pr-review-take-over')).toBeNull()
    expect(screen.getByTestId('pr-review-finish').getAttribute('aria-disabled')).toBe('false')
  })

  it('while the Session of an Agent review writes: Finish review inactive with its reason, and no Discard', async () => {
    preload({ draft: withComments([{ comment: on(2, 'A.'), by: 'agent' }], { agent: { sessionId: 's-1', state: 'writing' } }) })
    await mountReview({ how: 'agent' })
    await waitFor(() => expect(screen.getByTestId('pr-review-bar').dataset.state).toBe('writing'))
    const finish = screen.getByTestId('pr-review-finish')
    expect(finish.getAttribute('aria-disabled')).toBe('true')
    expect(finish.getAttribute('title')).toBe('Waits until the agent finishes or you stop it')
    expect(screen.queryByTestId('pr-review-discard')).toBeNull()
  })

  it('Discard asks «Discard N pending comments?»: Cancel keeps the draft; Discard removes it and Review mode closes', async () => {
    preload({ draft: withComments([{ comment: on(2, 'A.'), by: 'person' }, { comment: on(3, 'B.'), by: 'person' }, { comment: on(1, 'C.'), by: 'agent' }]) })
    const { mode } = await mountReview()
    fireEvent.click(await screen.findByTestId('pr-review-discard'))
    const ask = await screen.findByTestId('pr-review-discard-confirm')
    expect(within(ask).getByRole('heading').textContent).toBe('Discard 3 pending comments?')
    fireEvent.click(within(ask).getByTestId('pr-review-discard-cancel'))
    await waitFor(() => expect(screen.queryByTestId('pr-review-discard-confirm')).toBeNull())
    expect(calls('prReview.discard')).toEqual([])
    expect(mode.useReviewMode.getState().open).not.toBeNull()

    fireEvent.click(screen.getByTestId('pr-review-discard'))
    fireEvent.click(within(await screen.findByTestId('pr-review-discard-confirm')).getByTestId('pr-review-discard-ok'))
    await waitFor(() => expect(calls('prReview.discard')).toEqual([{ projectId: PROJECT, repo: REPO, number: NUMBER }]))
    await waitFor(() => expect(mode.useReviewMode.getState().open).toBeNull())
  })

  it('Discard is inactive with no comment', async () => {
    preload()
    await mountReview()
    expect(screen.getByTestId('pr-review-discard').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('pr-review-bar-count').textContent).toContain('No comments yet')
  })
})

describe('nothing to write to', () => {
  it('the draft could not be read and Start review failed: no «+», `c` opens nothing, nothing is written', async () => {
    preload({ answers: { 'prReview.draft': () => ({ ok: false, error: 'disk' }), 'prReview.start': () => ({ ok: false, error: 'disk' }) } })
    await mountReview({ draftless: true })
    await waitFor(() => expect(calls('prReview.start')).toHaveLength(1))
    await settle()
    expect(screen.queryAllByTestId('changes-line-plus')).toEqual([])
    fireEvent.click(line(2).querySelector('.w-changes__code')!)
    fireEvent.keyDown(document.body, { key: 'c' })
    await settle()
    expect(screen.queryByTestId('changes-comment-popover')).toBeNull()
    expect(writes()).toEqual([])
  })

  it('a Linked machine: no «+», no `c`, no prReview call', async () => {
    preload()
    await mountReview({ readOnly: 'Review on the machine of the Project' })
    expect(screen.queryAllByTestId('changes-line-plus')).toEqual([])
    fireEvent.click(line(2).querySelector('.w-changes__code')!)
    fireEvent.keyDown(document.body, { key: 'c' })
    await settle()
    expect(screen.queryByTestId('changes-comment-popover')).toBeNull()
    expect(main.calls.filter((call) => call.channel.startsWith('prReview.'))).toEqual([])
  })
})

describe('the chip Review draft of a list row', () => {
  it('a row with a draft of comments: «Review draft», «3 pending comments, started on 3f2a9c1»; none without one', async () => {
    preload()
    const { PrListItem } = await import('../../src/renderer/pr-inbox/PrInboxView')
    const props = { group: 'needs-review' as const, row: row(), ticket: undefined, viewer: 'dev-me', now: Date.parse('2026-11-20T12:00:00Z'), selected: false, onSelect: vi.fn() }
    const first = render(<PrListItem {...props} draft={{ repo: REPO, pr: NUMBER, comments: 3, startedOn: HEAD, state: 'draft' }} />)
    const chip = screen.getByTestId('pr-review-draft-chip')
    expect(chip.textContent).toBe('Review draft')
    expect(chip.getAttribute('title')).toBe('3 pending comments, started on 3f2a9c1')
    first.unmount()
    render(<PrListItem {...props} />)
    expect(screen.queryByTestId('pr-review-draft-chip')).toBeNull()
  })

  it('useReviewDrafts reads prReview.drafts for the Project, and again after a change of a draft', async () => {
    preload({ draft: withComments([{ comment: on(2, 'A.'), by: 'person' }]) })
    const store = await import('../../src/renderer/pr-review/review-store')
    function Probe() {
      const drafts = store.useReviewDrafts(PROJECT)
      return <span data-testid="probe">{JSON.stringify([...drafts.values()].map((each) => `${each.repo}#${each.pr}:${each.comments}`))}</span>
    }
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe(JSON.stringify([`${REPO}#${NUMBER}:1`])))
    expect(calls('prReview.drafts')).toEqual([{ projectId: PROJECT }])
    main.draft = withComments([{ comment: on(2, 'A.'), by: 'person' }, { comment: on(3, 'B.'), by: 'person' }])
    act(() => store.draftChanged())
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe(JSON.stringify([`${REPO}#${NUMBER}:2`])))
  })
})
