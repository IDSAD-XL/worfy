// Review mode and the choice of who writes the review (worfy-pr-review ticket 09; src/renderer/pr-review/), over a fake
// preload bridge that answers the channels in the shape main sends them:
// - Start review ▾: Review myself and Agent review in its menu; the button takes the Project's last choice, Review
//   myself until one is made; on a Linked machine it is inactive with «Review on the machine of the Project»;
// - Review mode: Start review creates the draft on the PR's head with the files of the diff (`prReview.start`); Agent
//   review asks for its Session after it (`prReview.agentReview`, `fill: 'new'`); j / k and ↓ / ↑ move along the
//   files, n / p along the hunks, v marks the file Viewed at its blob (`prReview.setViewed`); a mark at another blob
//   (a new head) shows the file not Viewed; Escape a menu took leaves Review mode open, the next Escape closes it;
// - a head past the draft's commit: «N new commits since you started», Show new commits reads Since my review from it;
// - the bar: Ask the agent to add comments (`fill: 'add'`) on the person's draft; «Agent is writing the review…» with
//   Stop and Take over (`prReview.stopAgent`); Take over on the agent's draft after it; the agent's comments on their
//   lines, read again on `prReview.changed`;
// - read only (a Linked machine): no `prReview.*` call, no Viewed, no bar.
// Every repository, login, path and text is invented. Nothing here reaches GitHub.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangedFile, FileDiff } from '../../src/shared/changes/types'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrInboxRow } from '../../src/shared/ipc/pr-inbox'
import type { ReviewDraft } from '../../src/shared/ipc/pr-review'

const PROJECT = 'web-00000001'
const REPO = 'example-org/web'
const NUMBER = 77
const HEAD = '3f2a9c1e5b7d4a6c8e0f1a2b3c4d5e6f7a8b9c0d'
const NEW_HEAD = '7d0e4b2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MIDDLE = '5c5c5c5ccccccccccccccccccccccccccccccccc'
const BASE = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'

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
  unresolvedThreads: 1,
  newSinceSeen: 0,
  lastActivityAt: '2026-11-20T10:00:00Z',
  threads: [{ id: 'T1', isResolved: false, isOutdated: false, path: 'src/net/retry.ts', line: 2, side: 'RIGHT', viewerCanReply: true, comments: [{ id: 'C1', databaseId: 1, author: 'dev-ana', body: 'Why three tries?', createdAt: '2026-11-20T09:00:00Z', url: 'https://github.com/example-org/web/pull/77#discussion_r1' }] }],
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

const FILES = [file('src/net/retry.ts'), file('src/net/backoff.ts', { status: 'A', oldBlob: null, oldMode: null, additions: 1, deletions: 0 })]

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

const draftOf = (over: Partial<ReviewDraft> = {}): ReviewDraft => ({ schema: 1, repo: REPO, pr: NUMBER, startedOn: HEAD, payload: { body: '', comments: [] }, anchors: [], viewed: {}, state: 'draft', ...over })

interface Fake {
  calls: { channel: string; input: Record<string, unknown> }[]
  draft: ReviewDraft | null
  commits: string[]
  emit: (channel: string, payload: unknown) => void
}

let main: Fake

function preload(start: { draft?: ReviewDraft | null; commits?: string[]; answers?: Record<string, (input: Record<string, unknown>) => IpcResult<unknown>> } = {}): void {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 0
  const fake: Fake = {
    calls: [],
    draft: start.draft ?? null,
    commits: start.commits ?? [],
    emit: (channel, payload) => {
      for (const each of handlers.values()) if (each.channel === channel) each.handler(payload)
    },
  }
  const answer = (channel: string, input: Record<string, unknown>): IpcResult<unknown> => {
    const own = start.answers?.[channel]
    if (own !== undefined) return own(input)
    const draftAnswer = () => ({ ok: true as const, value: { repo: REPO, pr: NUMBER, draft: fake.draft, problem: null } })
    switch (channel) {
      case 'changes.list':
        return { ok: true, value: { repos: [{ repo: REPO, kind: 'pr', branch: `#${NUMBER}`, scope: (input.scope as { kind: string }).kind, base: null, headSha: HEAD, workTree: false, files: FILES, additions: 3, deletions: 1, error: null, source: 'github', truncatedAt: null }] } }
      case 'changes.file':
        return { ok: true, value: { file: hunks(input.path as string) } }
      case 'changes.commits':
        return { ok: true, value: { base: null, commits: fake.commits.map((sha) => ({ sha, short: sha.slice(0, 7), author: 'dev-bo', date: '2026-11-20T10:00:00Z', subject: 'x' })) } }
      case 'prReview.draft':
        return draftAnswer()
      case 'prReview.start':
        fake.draft ??= draftOf({ startedOn: input.head as string })
        return draftAnswer()
      case 'prReview.setViewed': {
        const viewed = { ...(fake.draft?.viewed ?? {}) }
        if (input.blob === null) delete viewed[input.path as string]
        else viewed[input.path as string] = input.blob as string
        fake.draft = { ...(fake.draft ?? draftOf()), viewed }
        return draftAnswer()
      }
      case 'prReview.agentReview':
        fake.draft = { ...(fake.draft ?? draftOf()), agent: { sessionId: 's-1', state: 'writing' } }
        return { ok: true, value: { nodeId: 'n-1', sessionId: 's-1', text: '/human-review', draft: fake.draft } }
      case 'prReview.stopAgent':
        fake.draft = { ...(fake.draft ?? draftOf()), agent: { sessionId: 's-1', state: 'stopped' } }
        return draftAnswer()
      default:
        return { ok: true, value: null }
    }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input: input as Record<string, unknown> })
      return Promise.resolve(answer(channel, input as Record<string, unknown>) as never)
    },
    on: (channel, handler) => {
      next += 1
      handlers.set(next, { channel, handler: handler as (payload: unknown) => void })
      return next
    },
    off: (id) => {
      handlers.delete(id)
    },
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

const calls = (channel: string): Record<string, unknown>[] => main.calls.filter((call) => call.channel === channel).map((call) => call.input)

beforeEach(() => {
  vi.resetModules()
  globalThis.localStorage.clear()
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** Review mode on the PR, opened as Start review opens it. */
async function mountReview(options: { how?: 'myself' | 'agent'; readOnly?: string | null; row?: PrInboxRow } = {}) {
  const mode = { ...(await import('../../src/renderer/pr-review/ReviewMode')), ...(await import('../../src/renderer/pr-review/review-store')) }
  const readOnly = options.readOnly ?? null
  mode.openReviewMode({ projectId: PROJECT, repo: REPO, number: NUMBER }, options.how ?? 'myself', readOnly !== null)
  const onRefresh = vi.fn()
  const view = render(<mode.ReviewMode projectId={PROJECT} row={options.row ?? row()} readOnly={readOnly} onRefresh={onRefresh} />)
  await waitFor(() => expect(screen.getAllByTestId('changes-tree-file')).toHaveLength(2))
  return { mode, onRefresh, view }
}

const treeFile = (path: string): HTMLElement => screen.getAllByTestId('changes-tree-file').find((each) => each.dataset.path === path)!
const key = (name: string, init: KeyboardEventInit = {}): boolean => fireEvent.keyDown(document.body, { key: name, ...init })

describe('Start review ▾', () => {
  it('the menu holds Review myself and Agent review; the button takes the last choice of the Project, Review myself first', async () => {
    preload()
    const { StartReviewMenu } = await import('../../src/renderer/pr-review/StartReviewMenu')
    const onStart = vi.fn()
    const first = render(<StartReviewMenu projectId={PROJECT} away={null} onStart={onStart} />)
    const button = screen.getByTestId('pr-inbox-next-step-action')
    expect(button.textContent).toBe('Start review')
    expect(button.dataset.how).toBe('myself')
    fireEvent.click(button)
    expect(onStart).toHaveBeenLastCalledWith('myself')

    fireEvent.click(screen.getByTestId('pr-review-start-more'))
    const menu = await screen.findByTestId('pr-review-start-menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Review myselfYou write the comments and choose the verdict', 'Agent reviewAn agent drafts it; you edit and submit'])
    fireEvent.click(within(menu).getByTestId('pr-review-start-agent'))
    expect(onStart).toHaveBeenLastCalledWith('agent')
    first.unmount()

    // Remembered for the Project: a new button starts with it; another Project does not.
    render(<StartReviewMenu projectId={PROJECT} away={null} onStart={onStart} />)
    expect(screen.getByTestId('pr-inbox-next-step-action').textContent).toBe('Start review · Agent')
    fireEvent.click(screen.getByTestId('pr-inbox-next-step-action'))
    expect(onStart).toHaveBeenLastCalledWith('agent')
    cleanup()
    render(<StartReviewMenu projectId="ops-00000002" away={null} onStart={onStart} />)
    expect(screen.getByTestId('pr-inbox-next-step-action').dataset.how).toBe('myself')
  })

  it('a Linked machine: inactive, «Review on the machine of the Project», a click starts nothing', async () => {
    preload()
    const { StartReviewMenu } = await import('../../src/renderer/pr-review/StartReviewMenu')
    const onStart = vi.fn()
    render(<StartReviewMenu projectId={PROJECT} away="Review on the machine of the Project" onStart={onStart} />)
    const button = screen.getByTestId('pr-inbox-next-step-action')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('title')).toBe('Review on the machine of the Project')
    fireEvent.click(button)
    fireEvent.click(screen.getByTestId('pr-review-start-more'))
    expect(screen.queryByTestId('pr-review-start-menu')).toBeNull()
    expect(onStart).not.toHaveBeenCalled()
  })
})

describe('Review mode', () => {
  it('entering: the PR read again, the draft started on the head with the files of the diff; the head of the screen', async () => {
    preload()
    const { onRefresh } = await mountReview()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(calls('prReview.start')).toHaveLength(1))
    expect(calls('prReview.start')[0]).toEqual({
      projectId: PROJECT,
      repo: REPO,
      number: NUMBER,
      head: HEAD,
      files: [
        { path: 'src/net/retry.ts', blob: 'new-src/net/retry.ts' },
        { path: 'src/net/backoff.ts', blob: 'new-src/net/backoff.ts' },
      ],
    })
    expect(calls('changes.list')[0]).toMatchObject({ subject: { kind: 'pr', repo: REPO, number: NUMBER, headOid: HEAD, baseOid: BASE }, scope: { kind: 'all' } })
    expect(screen.getByTestId('pr-review-branches').textContent).toBe('main ← fix/retry-429')
    expect(screen.getByTestId('pr-review-head').textContent).toBe('3f2a9c1')
    expect(screen.getByTestId('pr-review-size').textContent).toBe('2 files · +3 −1')
    await waitFor(() => expect(screen.getByTestId('pr-review-viewed-count').textContent).toBe('Viewed 0/2'))
    // The thread of GitHub counted on its file in the tree.
    expect(within(treeFile('src/net/retry.ts')).getByTestId('pr-review-tree-count').textContent).toBe('1')
    // No Agent review was asked.
    expect(calls('prReview.agentReview')).toEqual([])
  })

  it('j / k and ↓ / ↑ move along the files, n / p along the hunks; the keys of a field are its own', async () => {
    preload()
    const { mode } = await mountReview()
    // The tree's order: retry.ts, then backoff.ts.
    expect(key('j')).toBe(false)
    expect(mode.useReviewMode.getState().file).toBe(`${REPO}\u0000src/net/retry.ts`)
    key('ArrowDown')
    expect(mode.useReviewMode.getState().file).toBe(`${REPO}\u0000src/net/backoff.ts`)
    key('k')
    expect(mode.useReviewMode.getState().file).toBe(`${REPO}\u0000src/net/retry.ts`)
    key('j')
    key('ArrowUp')
    expect(mode.useReviewMode.getState().file).toBe(`${REPO}\u0000src/net/retry.ts`)
    expect(key('n')).toBe(false)
    expect(key('p')).toBe(false)
    fireEvent.keyDown(screen.getByTestId('changes-filter'), { key: 'j' })
    expect(mode.useReviewMode.getState().file).toBe(`${REPO}\u0000src/net/retry.ts`)
  })

  it('v marks the file Viewed at its blob and v again takes it off; a mark at another blob shows the file not Viewed', async () => {
    preload({ draft: draftOf({ viewed: { 'src/net/retry.ts': 'old-head-blob' } }) })
    await mountReview()
    await waitFor(() => expect(calls('prReview.draft').length).toBeGreaterThan(0))
    // Marked Viewed on an older head: the blob changed since, so not Viewed now.
    await waitFor(() => expect(screen.getByTestId('pr-review-viewed-count').textContent).toBe('Viewed 0/2'))
    expect(within(treeFile('src/net/retry.ts')).getByTestId('pr-review-tree-viewed').dataset.viewed).toBe('false')
    key('j')
    key('v')
    await waitFor(() => expect(calls('prReview.setViewed')).toHaveLength(1))
    expect(calls('prReview.setViewed')[0]).toEqual({ projectId: PROJECT, repo: REPO, number: NUMBER, head: HEAD, path: 'src/net/retry.ts', blob: 'new-src/net/retry.ts' })
    await waitFor(() => expect(screen.getByTestId('pr-review-viewed-count').textContent).toBe('Viewed 1/2'))
    expect(within(treeFile('src/net/retry.ts')).getByTestId('pr-review-tree-viewed').dataset.viewed).toBe('true')
    key('v')
    await waitFor(() => expect(calls('prReview.setViewed')).toHaveLength(2))
    expect(calls('prReview.setViewed')[1]).toMatchObject({ path: 'src/net/retry.ts', blob: null })
    await waitFor(() => expect(screen.getByTestId('pr-review-viewed-count').textContent).toBe('Viewed 0/2'))
  })

  it('Escape: one a menu took (marked handled) leaves Review mode open; the next closes it, and the draft stays', async () => {
    preload()
    const { mode } = await mountReview()
    await waitFor(() => expect(calls('prReview.start')).toHaveLength(1))
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    handled.preventDefault()
    act(() => void document.body.dispatchEvent(handled))
    expect(mode.useReviewMode.getState().open).not.toBeNull()
    act(() => void key('Escape'))
    expect(mode.useReviewMode.getState().open).toBeNull()
    expect(calls('prReview.discard')).toEqual([])
  })

  it('the head moved past the draft: «2 new commits since you started»; Show new commits reads the diff since the draft\'s commit', async () => {
    preload({ draft: draftOf({ startedOn: HEAD }), commits: [HEAD, MIDDLE, NEW_HEAD] })
    await mountReview({ row: row({ headRefOid: NEW_HEAD }) })
    const bar = await screen.findByTestId('pr-review-new-commits')
    await waitFor(() => expect(bar.textContent).toContain('2 new commits since you started'))
    expect(bar.textContent).toContain('you started on 3f2a9c1, the head is 7d0e4b2')
    fireEvent.click(within(bar).getByTestId('pr-review-show-new'))
    await waitFor(() => expect(calls('changes.list').at(-1)).toMatchObject({ scope: { kind: 'compare', repo: REPO, ref: HEAD } }))
    expect(within(bar).getByTestId('pr-review-show-new').textContent).toBe('Show all changes')
  })

  it('a draft placed on a later commit (anchoredOn): the bar counts from it, the commit its lines are numbered on', async () => {
    preload({ draft: draftOf({ startedOn: HEAD, anchoredOn: MIDDLE }), commits: [HEAD, MIDDLE, NEW_HEAD] })
    await mountReview({ row: row({ headRefOid: NEW_HEAD }) })
    await waitFor(() => expect(screen.getByTestId('pr-review-new-commits').textContent).toContain('1 new commit since you started'))
  })

  it('Ask the agent to add comments on the person\'s draft; while the agent writes, Stop and Take over stop its Session', async () => {
    preload({ draft: draftOf() })
    await mountReview()
    const bar = await screen.findByTestId('pr-review-bar')
    expect(bar.dataset.state).toBe('person')
    fireEvent.click(within(bar).getByTestId('pr-review-ask-agent'))
    await waitFor(() => expect(calls('prReview.agentReview')).toEqual([{ projectId: PROJECT, repo: REPO, number: NUMBER, head: HEAD, fill: 'add' }]))
    await waitFor(() => expect(screen.getByTestId('pr-review-bar').dataset.state).toBe('writing'))
    expect(screen.getByTestId('pr-review-bar').textContent).toContain('Agent is writing the review…')
    fireEvent.click(within(screen.getByTestId('pr-review-bar')).getByTestId('pr-review-stop'))
    await waitFor(() => expect(calls('prReview.stopAgent')).toEqual([{ projectId: PROJECT, repo: REPO, number: NUMBER }]))
    await waitFor(() => expect(screen.getByTestId('pr-review-bar').dataset.state).toBe('person'))
    expect(screen.getByTestId('pr-review-bar').textContent).toContain('Agent stopped')

    main.draft = draftOf({ agent: { sessionId: 's-2', state: 'writing' } })
    act(() => main.emit('prReview.changed', { projectId: PROJECT, repo: REPO, number: NUMBER }))
    await waitFor(() => expect(screen.getByTestId('pr-review-bar').dataset.state).toBe('writing'))
    fireEvent.click(within(screen.getByTestId('pr-review-bar')).getByTestId('pr-review-take-over'))
    await waitFor(() => expect(calls('prReview.stopAgent')).toHaveLength(2))
  })

  it('the agent\'s draft after it wrote: Take over, the comments «Written by the agent» on their lines, the suggested verdict', async () => {
    const comment = { path: 'src/net/retry.ts', line: 2, side: 'RIGHT' as const, body: 'Read Retry-After first.' }
    preload({ draft: draftOf({ payload: { body: 'Close.', comments: [comment] }, anchors: [{ text: 'const WAIT = [100, 400]', by: 'agent' }], suggestedEvent: 'REQUEST_CHANGES', agent: { sessionId: 's-1', state: 'done' } }) })
    await mountReview()
    const bar = await screen.findByTestId('pr-review-bar')
    await waitFor(() => expect(bar.dataset.state).toBe('agent'))
    expect(within(bar).getByTestId('pr-review-bar-count').textContent).toBe('1 comment (1 by the agent) on 1 file')
    expect(within(bar).getByTestId('pr-review-suggests').textContent).toBe('· The agent suggests: Request changes')
    expect(within(bar).queryByTestId('pr-review-ask-agent')).toBeNull()
    const onLine = await screen.findByTestId('pr-review-comment')
    expect(onLine.dataset.by).toBe('agent')
    expect(onLine.textContent).toContain('Written by the agent')
    expect(onLine.textContent).toContain('Read Retry-After first.')
    fireEvent.click(within(bar).getByTestId('pr-review-take-over'))
    await waitFor(() => expect(calls('prReview.stopAgent')).toHaveLength(1))
  })

  it('Agent review from Start review: the draft first, then its Session with `fill: new`; the comments come as it writes', async () => {
    preload()
    await mountReview({ how: 'agent' })
    await waitFor(() => expect(calls('prReview.agentReview')).toEqual([{ projectId: PROJECT, repo: REPO, number: NUMBER, head: HEAD, fill: 'new' }]))
    const order = main.calls.map((call) => call.channel).filter((channel) => channel === 'prReview.start' || channel === 'prReview.agentReview')
    expect(order).toEqual(['prReview.start', 'prReview.agentReview'])
    await waitFor(() => expect(screen.getByTestId('pr-review-bar').dataset.state).toBe('writing'))
    main.draft = { ...main.draft!, payload: { body: '', comments: [{ path: 'src/net/retry.ts', line: 3, side: 'RIGHT', body: 'Jitter as a fraction?' }] }, anchors: [{ text: 'const JITTER = 0.1', by: 'agent' }] }
    act(() => main.emit('prReview.changed', { projectId: PROJECT, repo: REPO, number: NUMBER }))
    await waitFor(() => expect(screen.getByTestId('pr-review-comment').textContent).toContain('Jitter as a fraction?'))
  })

  it('the files of the PR not read (the read failed, GitHub refused the repository): no Start review; Refresh reads them, and Start review goes then with the files', async () => {
    let reads = 0
    const listed = (files: ChangedFile[], error: string | null): IpcResult<unknown> => ({
      ok: true,
      value: { repos: [{ repo: REPO, kind: 'pr', branch: `#${NUMBER}`, scope: 'all', base: null, headSha: HEAD, workTree: false, files, additions: 3, deletions: 1, error, source: 'github', truncatedAt: null }] },
    })
    preload({
      answers: {
        'changes.list': () => {
          reads += 1
          if (reads === 1) return { ok: false, error: 'changes.list failed: HTTP 502' }
          if (reads === 2) return listed([], 'API rate limit exceeded')
          return listed(FILES, null)
        },
      },
    })
    const mode = { ...(await import('../../src/renderer/pr-review/ReviewMode')), ...(await import('../../src/renderer/pr-review/review-store')) }
    mode.openReviewMode({ projectId: PROJECT, repo: REPO, number: NUMBER }, 'myself', false)
    render(<mode.ReviewMode projectId={PROJECT} row={row()} readOnly={null} onRefresh={vi.fn()} />)
    await waitFor(() => expect(reads).toBe(1))
    await act(async () => Promise.resolve())
    expect(calls('prReview.start')).toEqual([])
    fireEvent.click(screen.getByTestId('pr-review-refresh'))
    await waitFor(() => expect(reads).toBe(2))
    await act(async () => Promise.resolve())
    expect(calls('prReview.start')).toEqual([])
    fireEvent.click(screen.getByTestId('pr-review-refresh'))
    await waitFor(() => expect(calls('prReview.start')).toHaveLength(1))
    expect((calls('prReview.start')[0]!.files as unknown[]).length).toBe(2)
  })

  it('more files than a draft keeps marks for (local git lists them all): Start review sends the first 3,000', async () => {
    const many = Array.from({ length: 3_005 }, (_, index) => file(`src/f/${String(index).padStart(4, '0')}.ts`))
    preload({
      answers: {
        'changes.list': () => ({
          ok: true,
          value: { repos: [{ repo: REPO, kind: 'pr', branch: `#${NUMBER}`, scope: 'all', base: null, headSha: HEAD, workTree: false, files: many, additions: 3, deletions: 1, error: null, source: 'git', truncatedAt: null }] },
        }),
      },
    })
    const mode = { ...(await import('../../src/renderer/pr-review/ReviewMode')), ...(await import('../../src/renderer/pr-review/review-store')) }
    mode.openReviewMode({ projectId: PROJECT, repo: REPO, number: NUMBER }, 'myself', false)
    render(<mode.ReviewMode projectId={PROJECT} row={row()} readOnly={null} onRefresh={vi.fn()} />)
    await waitFor(() => expect(calls('prReview.start')).toHaveLength(1))
    expect((calls('prReview.start')[0]!.files as unknown[]).length).toBe(3_000)
  })

  it('no draft yet (Start review refused): v writes nothing, so github.com marks are not skipped later; no Viewed box either', async () => {
    preload({ answers: { 'prReview.start': () => ({ ok: false, error: 'prReview.start failed: no Profile folder' }) } })
    await mountReview()
    await waitFor(() => expect(calls('prReview.start')).toHaveLength(1))
    key('j')
    key('v')
    expect(screen.queryByTestId('pr-review-viewed')).toBeNull()
    await act(async () => Promise.resolve())
    expect(calls('prReview.setViewed')).toEqual([])
  })

  it('the keys work from a checkbox (Viewed, Wrap); a text field keeps them', async () => {
    preload()
    const { mode } = await mountReview()
    await waitFor(() => expect(screen.getAllByTestId('pr-review-viewed')).toHaveLength(2))
    const box = screen.getAllByTestId('pr-review-viewed').find((each) => each.dataset.path === 'src/net/retry.ts')!
    fireEvent.keyDown(box, { key: 'j' })
    expect(mode.useReviewMode.getState().file).toBe(`${REPO}\u0000src/net/retry.ts`)
    fireEvent.keyDown(box, { key: 'j' })
    expect(mode.useReviewMode.getState().file).toBe(`${REPO}\u0000src/net/backoff.ts`)
    fireEvent.keyDown(screen.getByTestId('changes-filter'), { key: 'Escape' })
    expect(mode.useReviewMode.getState().open).not.toBeNull()
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Wrap' }), { key: 'Escape' })
    expect(mode.useReviewMode.getState().open).toBeNull()
  })

  it('read only (a Linked machine): the diff and the threads, no draft, no Viewed, no bar', async () => {
    preload()
    await mountReview({ readOnly: 'Beta gives this Machine read-only access' })
    expect(screen.getByTestId('pr-review-mode').dataset.readOnly).toBe('true')
    expect(screen.getByTestId('pr-review-read-only').textContent).toBe('Read only')
    await waitFor(() => expect(screen.getAllByTestId('changes-hunk').length).toBeGreaterThan(0))
    key('j')
    key('v')
    expect(main.calls.filter((call) => call.channel.startsWith('prReview.'))).toEqual([])
    expect(screen.queryByTestId('pr-review-bar')).toBeNull()
    expect(screen.queryByTestId('pr-review-viewed')).toBeNull()
    expect(screen.queryByTestId('pr-review-viewed-count')).toBeNull()
  })
})
