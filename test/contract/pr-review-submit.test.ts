// Submit review (worfy-pr-review ticket 11, ADR-0112; src/main/github/pr-review-submit.ts) over a temporary Profile
// folder, the gh stand-in (test/fixtures/gh/gh-stub.mjs, which fails the test on any write but the one POST of a review)
// and the repository's own harness/bin/review-draft-lint over a temporary HOME and HARNESS_HOME:
// - a finding of the lint: no POST at all, the draft stays a draft;
// - the head moved since the dialog opened: refused with the head now; the comments go on the commit of the draft
//   (`anchoredOn`, else `startedOn`), whatever the head is;
// - exactly one POST, its body byte for byte the texts the dialog showed, with `commit_id` that commit;
// - Approve or Request changes on the account's own PR: refused before the POST;
// - GitHub 500 without the review landed: nothing more is posted; the next Submit looks on GitHub first, then posts once;
//   with the review landed it is only marked submitted; a 422 says GitHub's reason, gives back the comments removed in
//   the dialog, and the next Submit posts at once;
// - `submitting` left by a crash, or a Submit GitHub did not confirm: only the same texts go again, and the lookup runs
//   before every other check (a moved head too); it takes a review of this account on that commit with that body and
//   those line comments, in any state, given from the mark on; nothing found frees the draft;
// - the Profile's lint.json with `--untiered`: every text held to its largest length, its forbidden words still found;
// - an Agent review: the event of the POST is the one the person chose, not the one the agent suggested; a comment the
//   person removed in the dialog is not posted; nothing while the agent writes;
// - a comment not on a changed line of GitHub's diff, or a range across hunks: refused, no POST;
// - reading the draft and the check of the dialog post nothing; no account named posts nothing.
// Nothing reaches GitHub or a model: owners, repositories, logins, shas and texts are invented.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrReviewDrafts, reviewDraftFilePath } from '../../src/main/github/pr-review-draft'
import { AGENT_WRITING, NO_ACCOUNT, NOT_LISTED_YET, OWN_PULL, PrReviewSubmitter, submitLintArgs, UNCONFIRMED, type PrReviewSubmitterOptions } from '../../src/main/github/pr-review-submit'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { prReviewHandlers } from '../../src/main/ipc/pr-review'
import { createLinkIpc } from '../../src/main/link/ipc-adapter'
import { runHarnessScript } from '../../src/main/workflow/profile'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { LISTING_WAIT_MS, prReviewCheck, prReviewSubmit, type PrReviewSubmitAnswer, type ReviewComment, type ReviewDraft, type ReviewEvent } from '../../src/shared/ipc/pr-review'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'
import { ghWorld, type GhWorld } from './gh-world'

const LINT = join(process.cwd(), 'harness', 'bin', 'review-draft-lint')

const ME = 'dev-me'
const ANA = 'dev-ana'
const API = 'demo-org/api'
const PR = 118
const PROJECT = 'demo-0000000d'
const START = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const MOVED = 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2'
const ANCHORED = 'e5f60718293a4b5c6d7e8f9012345678a1b2c3d4'
const BASE = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
const FILE = 'src/upload.ts'
/**
 * Two hunks of src/upload.ts: the new side has lines 1–5 and 22–24, the old side 1–3 and 20–21. A comment on new line
 * 10 is on no changed line; a range from 3 to 23 crosses the hunks.
 */
const PATCH = '@@ -1,3 +1,5 @@\n const a = 1\n+const b = 2\n+const c = 3\n const d = 4\n const e = 5\n@@ -20,2 +22,3 @@\n function f() {\n+  return retry()\n }'
/** What the person typed: quotes, a line break, an `@`, a placeholder of gh, `=` and characters beyond ASCII. */
/** The time of a mark `minutes` ago, as the file keeps it. */
const markedAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()
/** Minutes past the wait for GitHub to list a review. */
const PAST_WAIT = LISTING_WAIT_MS / 60_000 + 1
/** The draft file with its mark `submitting` moved back in time: GitHub had that long to list the review. */
function ageMark(s: { file: string; onDisk: () => ReviewDraft }, minutes: number): void {
  writeFileSync(s.file, JSON.stringify({ ...s.onDisk(), submittingAt: markedAgo(minutes) }))
}
const TYPED = 'Good catch — the server drops the first try.\n@team: "{owner}" stays; retries=3, naïve ✓\n'

beforeEach(() => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, undefined)
})

const temps: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

const on = (line: number, body: string, over: Partial<ReviewComment> = {}): ReviewComment => ({ path: FILE, line, side: 'RIGHT', body, ...over })

/** review-draft-lint as the app starts it (runHarnessScript), over a temporary HOME and HARNESS_HOME: no Profile of this machine is read. */
function lintRunner(base: string): PrReviewSubmitterOptions['lint'] {
  const home = join(base, 'home')
  const harnessHome = join(base, 'harness-home')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [] }))
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
  for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete env[name]
  env.PATH = `${dirname(scriptNode())}${delimiter}${env.PATH ?? ''}`
  return (draft, root, rules) => runHarnessScript(LINT, submitLintArgs(root, rules), env, { stdin: draft, timeoutMs: ms(30_000) })
}

interface World {
  /** The head GitHub has now. */
  head?: string
  author?: string
  reviews?: Record<string, unknown>
}

interface Setup {
  gh: GhWorld
  root: string
  file: string
  submitter: PrReviewSubmitter
  /** Every gh call that is not a read. */
  writes: () => string[][]
  /** The reviews the stand-in took, the request of each as GitHub got it. */
  posted: () => { raw: string; request: Record<string, unknown>; login: string }[]
  onDisk: () => ReviewDraft
  call: <T>(channel: string, input: unknown) => Promise<IpcResult<T>>
  /** The PRs the PR inbox was asked to read again, `repo#number`. */
  refreshed: string[]
  /** The Profile folder of the Project. */
  profileDir: string
}

function draftOf(comments: readonly { comment: ReviewComment; by: 'person' | 'agent' }[], over: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    schema: 1,
    repo: API,
    pr: PR,
    startedOn: START,
    payload: { body: '', comments: comments.map(({ comment }) => comment) },
    anchors: comments.map(({ by }) => ({ text: 'const b = 2', by })),
    viewed: {},
    state: 'draft',
    ...over,
  }
}

async function setup(draft: ReviewDraft, world: World = {}, over: Partial<PrReviewSubmitterOptions> = {}): Promise<Setup> {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-submit-')))
  temps.push(base)
  const root = join(base, 'project')
  const profileDir = join(base, 'profile')
  mkdirSync(root, { recursive: true })
  const gh = ghWorld(join(base, 'gh'), { accounts: [{ login: ME, token: 'tok-me' }] })
  const head = world.head ?? START
  const files = [{ filename: FILE, status: 'modified', additions: 3, deletions: 0, sha: 'blob1', patch: PATCH }]
  writeFileSync(
    join(gh.dir, 'rest.json'),
    JSON.stringify({
      [`repos/${API}/pulls/${PR}`]: { number: PR, state: 'open', user: { login: world.author ?? ANA }, head: { sha: head }, base: { sha: BASE } },
      [`repos/${API}/pulls/${PR}/files?per_page=100&page=1`]: files,
      [`repos/${API}/compare/${BASE}...${START}`]: { files },
      [`repos/${API}/compare/${BASE}...${ANCHORED}`]: { files },
    }),
  )
  writeFileSync(join(gh.dir, 'reviews.json'), JSON.stringify(world.reviews ?? {}))
  const file = reviewDraftFilePath(profileDir, API, PR)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`)
  const drafts = new PrReviewDrafts({ profileDir: async () => ({ dir: profileDir, reason: null }), warn: () => undefined })
  const submitter = new PrReviewSubmitter({ run: gh.run, account: async () => ME, drafts, profileDir: async () => ({ dir: profileDir, reason: null }), lint: lintRunner(base), ...over })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  // The PRs the PR inbox was asked to read again: after a Submit GitHub has, the approvals chip of the row.
  const refreshed: string[] = []
  const inbox = { refresh: async (repo: string, number: number) => void refreshed.push(`${repo}#${number}`) }
  await registerIpc(ipc, { modules: { './pr-review.ts': async () => prReviewHandlers({ drafts: () => drafts, root: () => root, submitter: () => submitter, inbox: () => inbox }) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  const call = async <T,>(channel: string, input: unknown) => (await handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<T>
  return {
    gh,
    root,
    file,
    submitter,
    writes: () => gh.calls().filter((args) => args.includes('--method') || args.includes('-X') || args.includes('--input') || args.includes('-f') || args.includes('-F')),
    posted: () => {
      const path = join(gh.dir, 'posted-reviews.json')
      const list = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { raw: string; login: string }[]) : []
      return list.map((each) => ({ ...each, request: JSON.parse(each.raw) as Record<string, unknown> }))
    },
    onDisk: () => JSON.parse(readFileSync(file, 'utf8')) as ReviewDraft,
    call,
    refreshed,
    profileDir,
  }
}

const POST = ['api', '--method', 'POST', `repos/${API}/pulls/${PR}/reviews`, '--input']
const isPost = (args: readonly string[]): boolean => POST.every((word, at) => args[at] === word) && args.length === 6
const shown = (input: { event: ReviewEvent; body: string; comments: ReviewComment[]; commit?: string; head?: string }) => ({ commit: START, head: START, ...input })

function ok<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`refused: ${result.error}`)
  return result.value
}

describe('Submit review', () => {
  it('posts once: the body byte for byte the texts shown, commit_id the commit of the draft, as the Project account', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, TYPED), on(23, 'Why three tries?', { start_line: 22, start_side: 'RIGHT' })]
    const s = await setup(draftOf(comments.map((comment) => ({ comment, by: 'person' }))))
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: 'Looks fine apart from the retry.', comments }))
    expect(answer.outcome, answer.reason ?? '').toBe('submitted')
    expect(s.writes().filter(isPost)).toHaveLength(1)
    expect(s.writes()).toHaveLength(1)
    const [review] = s.posted()
    expect(review?.login).toBe(ME)
    // The whole body, field by field and in the order GitHub's documentation lists them: nothing added.
    expect(review?.raw).toBe(JSON.stringify({ commit_id: START, event: 'COMMENT', body: 'Looks fine apart from the retry.', comments: [{ path: FILE, line: 2, side: 'RIGHT', body: TYPED }, { path: FILE, start_line: 22, start_side: 'RIGHT', line: 23, side: 'RIGHT', body: 'Why three tries?' }] }))
    expect(answer.reviewUrl).toBe(`https://github.com/${API}/pull/${PR}#pullrequestreview-7001`)
    const after = s.onDisk()
    expect(after.state).toBe('submitted')
    expect(after.reviewUrl).toBe(answer.reviewUrl)
    expect(after.payload.event).toBe('COMMENT')
    expect(typeof after.submittedAt).toBe('string')
    // A second click after it: the review is submitted, nothing more goes.
    const again = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: 'Looks fine apart from the retry.', comments }))
    expect(again.outcome).toBe('refused')
    expect(s.writes()).toHaveLength(1)
  })

  it('two clicks at once post once', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]))
    const input = shown({ event: 'COMMENT', body: '', comments })
    const both = await Promise.all([s.submitter.submit(s.root, API, PR, input), s.submitter.submit(s.root, API, PR, input)])
    expect(both.map((each) => each.outcome).sort()).toEqual(['refused', 'submitted'])
    expect(s.writes()).toHaveLength(1)
  })

  it('a finding of review-draft-lint: no POST, the draft stays a draft, the finding is the reason', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'The notes for this are in .scratch/notes.md.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]))
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments }))
    expect(answer.outcome).toBe('refused')
    expect(answer.reason).toContain('.scratch')
    expect(s.writes()).toEqual([])
    expect(s.onDisk().state).toBe('draft')
    // The check of the dialog finds the same, and posts nothing either.
    const check = await s.submitter.check(s.root, API, PR, { event: 'COMMENT', body: '', comments })
    expect(check.findings.join('\n')).toContain('.scratch')
    const clean = await s.submitter.check(s.root, API, PR, { event: 'COMMENT', body: 'Fine.', comments: [on(2, 'One.')] })
    expect(clean).toEqual({ findings: [], reason: null })
    expect(s.writes()).toEqual([])
  })

  it('the head moved since the dialog opened: refused with the head now, no POST; then the comments go on the commit of the draft', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]), { head: MOVED })
    const stale = await s.submitter.submit(s.root, API, PR, shown({ event: 'APPROVE', body: '', comments }))
    expect(stale.outcome).toBe('refused')
    expect(stale.head).toBe(MOVED)
    expect(s.writes()).toEqual([])
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'APPROVE', body: '', comments, head: MOVED }))
    expect(answer.outcome, answer.reason ?? '').toBe('submitted')
    expect(s.posted()[0]?.request.commit_id).toBe(START)
  })

  it('a draft placed again on a later commit (`anchoredOn`) posts on that commit, not on `startedOn`', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }], { anchoredOn: ANCHORED }), { head: MOVED })
    const wrong = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments, head: MOVED }))
    expect(wrong.outcome).toBe('refused')
    expect(s.writes()).toEqual([])
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments, commit: ANCHORED, head: MOVED }))
    expect(answer.outcome, answer.reason ?? '').toBe('submitted')
    expect(s.posted()[0]?.request.commit_id).toBe(ANCHORED)
  })

  it("Approve and Request changes on the account's own PR are refused before the POST; Comment goes", { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    for (const event of ['APPROVE', 'REQUEST_CHANGES'] as const) {
      const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]), { author: ME })
      const answer = await s.submitter.submit(s.root, API, PR, shown({ event, body: 'Body.', comments }))
      expect(answer.outcome).toBe('refused')
      expect(answer.reason).toBe(OWN_PULL)
      expect(s.writes()).toEqual([])
    }
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]), { author: ME })
    expect((await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments }))).outcome).toBe('submitted')
  })

  it('Comment and Request changes without a summary and without comments are refused: GitHub needs a body', { timeout: ms(60_000) }, async () => {
    for (const event of ['COMMENT', 'REQUEST_CHANGES'] as const) {
      const s = await setup(draftOf([]))
      const answer = await s.submitter.submit(s.root, API, PR, shown({ event, body: '  ', comments: [] }))
      expect(answer.outcome).toBe('refused')
      expect(s.writes()).toEqual([])
    }
    const s = await setup(draftOf([]))
    expect((await s.submitter.submit(s.root, API, PR, shown({ event: 'APPROVE', body: '', comments: [] }))).outcome).toBe('submitted')
  })

  it('GitHub 500, the review not landed: no retry; a Submit right after is refused while GitHub may not list it yet; later it looks first, then posts once', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]), { reviews: { status: 500 } })
    const input = shown({ event: 'COMMENT', body: 'Body.', comments })
    const failed = await s.submitter.submit(s.root, API, PR, input)
    expect(failed.outcome).toBe('failed')
    expect(failed.reason).toContain(UNCONFIRMED)
    expect(s.writes()).toHaveLength(1)
    const kept = s.onDisk()
    expect(kept.state).toBe('draft')
    expect(kept.error).toContain(UNCONFIRMED)
    // The time of the mark stays: the next Submit takes only a review given from then on.
    expect(Date.parse(kept.submittingAt ?? '')).toBeGreaterThan(Date.now() - ms(60_000))
    writeFileSync(join(s.gh.dir, 'reviews.json'), '{}')
    // Right after: GitHub may list a review late; nothing found is no proof yet, and the mark stays as it is.
    const soon = await s.submitter.submit(s.root, API, PR, input)
    expect(soon.outcome).toBe('refused')
    expect(soon.reason).toContain(NOT_LISTED_YET)
    expect(s.writes()).toHaveLength(1)
    expect(s.onDisk()).toEqual(kept)
    ageMark(s, PAST_WAIT)
    const again = await s.submitter.submit(s.root, API, PR, input)
    expect(again.outcome, again.reason ?? '').toBe('submitted')
    const calls = s.gh.calls()
    const look = calls.findIndex((args) => args[1] === `repos/${API}/pulls/${PR}/reviews?per_page=100&page=1`)
    const second = calls.findIndex((args, at) => at > calls.findIndex(isPost) && isPost(args))
    expect(look).toBeGreaterThan(-1)
    expect(look).toBeLessThan(second)
    expect(s.writes()).toHaveLength(2)
    expect(s.posted()).toHaveLength(1)
  })

  it('GitHub 500 with the review landed: the next Submit finds it and only marks the draft submitted', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]), { reviews: { status: 502, landed: true } })
    const input = shown({ event: 'REQUEST_CHANGES', body: 'Please cap the retries.', comments })
    expect((await s.submitter.submit(s.root, API, PR, input)).outcome).toBe('failed')
    writeFileSync(join(s.gh.dir, 'reviews.json'), '{}')
    const again = await s.submitter.submit(s.root, API, PR, input)
    expect(again.outcome).toBe('already-submitted')
    expect(again.reviewUrl).toBe(`https://github.com/${API}/pull/${PR}#pullrequestreview-7001`)
    expect(s.writes()).toHaveLength(1)
    expect(s.onDisk().state).toBe('submitted')
  })

  it('a review of the account on another commit, with another body, by another account, from before the mark or with other line comments is not taken for this one', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const marked = markedAgo(PAST_WAIT + 10)
    const after = new Date(Date.parse(marked) + 5_000).toISOString()
    const review = (id: number, over: Record<string, unknown>) => ({ id, user: { login: ME }, body: 'Body.', state: 'COMMENTED', html_url: `https://github.com/r${id}`, commit_id: START, submitted_at: after, comments: [{ path: FILE, line: 2, body: 'One.' }], ...over })
    const existing = [
      review(1, { commit_id: MOVED }),
      review(2, { body: 'Other.' }),
      review(3, { user: { login: ANA } }),
      // An earlier review of the same texts: New review on the same head, then a 502 that created nothing.
      review(4, { submitted_at: new Date(Date.parse(marked) - 20 * 60_000).toISOString() }),
      review(5, { comments: [{ path: FILE, line: 2, body: 'Another comment.' }] }),
      review(6, { comments: [] }),
    ]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }], { state: 'submitting', submittingAt: marked, payload: { event: 'COMMENT', body: 'Body.', comments } }), { reviews: { existing } })
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: 'Body.', comments }))
    expect(answer.outcome, answer.reason ?? '').toBe('submitted')
    expect(s.writes()).toHaveLength(1)
  })

  it('the review found is the one of the stored texts in any state: a Comment GitHub lists as dismissed or approved is still it', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const existing = [{ id: 8, user: { login: ME }, body: 'Body.', state: 'DISMISSED', html_url: `https://github.com/${API}/pull/${PR}#pullrequestreview-8`, commit_id: START, submitted_at: '2026-11-21T10:00:05Z', comments: [{ path: FILE, line: 2, body: 'One.' }] }]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }], { state: 'submitting', submittingAt: '2026-11-21T10:00:00.000Z', payload: { event: 'COMMENT', body: 'Body.', comments } }), { reviews: { existing } })
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: 'Body.', comments }))
    expect(answer.outcome, answer.reason ?? '').toBe('already-submitted')
    expect(s.writes()).toEqual([])
  })

  it('GitHub did not confirm an Approve that landed: a Submit of other texts is refused, the stored ones are found — never a second review', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]), { reviews: { status: 502, landed: true } })
    expect((await s.submitter.submit(s.root, API, PR, shown({ event: 'APPROVE', body: 'Ship it.', comments }))).outcome).toBe('failed')
    writeFileSync(join(s.gh.dir, 'reviews.json'), '{}')
    // The draft keeps the texts that went; the dialog shows them, and other ones are refused before any call.
    expect(s.onDisk().payload.event).toBe('APPROVE')
    for (const other of [shown({ event: 'COMMENT', body: 'Ship it.', comments }), shown({ event: 'APPROVE', body: 'Ship it now.', comments }), shown({ event: 'APPROVE', body: 'Ship it.', comments: [] })]) {
      const refused = await s.submitter.submit(s.root, API, PR, other)
      expect(refused.outcome).toBe('refused')
      expect(refused.reason).toContain(UNCONFIRMED)
    }
    expect(s.writes()).toHaveLength(1)
    const found = await s.submitter.submit(s.root, API, PR, shown({ event: 'APPROVE', body: 'Ship it.', comments }))
    expect(found.outcome, found.reason ?? '').toBe('already-submitted')
    expect(s.writes()).toHaveLength(1)
  })

  it('a Submit that may have landed looks first: found on a head that moved since, it is only marked; not found, the mark stays until the next POST', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const existing = [{ id: 9, user: { login: ME }, body: 'Body.', state: 'COMMENTED', html_url: `https://github.com/${API}/pull/${PR}#pullrequestreview-9`, commit_id: START, submitted_at: '2026-11-21T10:00:05Z', comments: [{ path: FILE, line: 2, body: 'One.' }] }]
    const pending = { state: 'draft' as const, error: `${UNCONFIRMED}: gh: Bad Gateway (HTTP 502)`, submittingAt: '2026-11-21T10:00:00.000Z', payload: { event: 'COMMENT' as const, body: 'Body.', comments } }
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }], pending), { head: MOVED, reviews: { existing } })
    const found = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: 'Body.', comments }))
    expect(found.outcome, found.reason ?? '').toBe('already-submitted')
    expect(s.onDisk().state).toBe('submitted')
    // Nothing on GitHub, the mark young: refused before any other check, the mark as it was.
    const young = { ...pending, submittingAt: markedAgo(1) }
    const u = await setup(draftOf([{ comment: comments[0]!, by: 'person' }], young), { head: MOVED, reviews: {} })
    const soon = await u.submitter.submit(u.root, API, PR, shown({ event: 'COMMENT', body: 'Body.', comments }))
    expect(soon.outcome).toBe('refused')
    expect(soon.reason).toContain(NOT_LISTED_YET)
    expect(u.gh.calls().some((args) => args[1] === `repos/${API}/pulls/${PR}`)).toBe(false)
    expect(u.onDisk()).toMatchObject(young)
    // Nothing on GitHub, the mark old: the head check refuses, and the mark stays; only the next POST clears it.
    const old = { ...pending, submittingAt: markedAgo(PAST_WAIT) }
    const t = await setup(draftOf([{ comment: comments[0]!, by: 'person' }], old), { head: MOVED, reviews: {} })
    const refused = await t.submitter.submit(t.root, API, PR, shown({ event: 'COMMENT', body: 'Body.', comments }))
    expect(refused.outcome).toBe('refused')
    expect(refused.head).toBe(MOVED)
    expect(t.onDisk()).toMatchObject(old)
    expect(t.writes()).toEqual([])
  })

  it('GitHub refuses (422) a review with a comment removed in the dialog: the draft has all its comments again', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.'), on(3, 'Two.'), on(4, 'Three.')]
    const draft = draftOf(comments.map((comment, at) => ({ comment, by: at === 1 ? 'agent' : 'person' })))
    const s = await setup(draft, { reviews: { status: 422, message: 'Validation Failed' } })
    const refused = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments: [comments[0]!, comments[2]!] }))
    expect(refused.outcome).toBe('failed')
    const after = s.onDisk()
    expect(after.state).toBe('draft')
    expect(after.payload.comments).toEqual(comments)
    expect(after.anchors).toEqual(draft.anchors)
    expect(after.submittingAt).toBeUndefined()
  })

  it('`submitting` left by a crash: the next Submit looks on GitHub first and only marks a review found', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const existing = [{ id: 9, user: { login: ME }, body: 'Body.', state: 'COMMENTED', html_url: `https://github.com/${API}/pull/${PR}#pullrequestreview-9`, commit_id: START, submitted_at: '2026-11-21T10:00:05Z', comments: [{ path: FILE, line: 2, body: 'One.' }] }]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }], { state: 'submitting', payload: { event: 'COMMENT', body: 'Body.', comments } }), { reviews: { existing } })
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: 'Body.', comments }))
    expect(answer.outcome).toBe('already-submitted')
    expect(answer.reviewUrl).toBe(existing[0]!.html_url)
    expect(s.writes()).toEqual([])
    // Other texts than the ones being submitted when it stopped are refused: the dialog shows the file's.
    const t = await setup(draftOf([{ comment: comments[0]!, by: 'person' }], { state: 'submitting', payload: { event: 'COMMENT', body: 'Body.', comments } }))
    expect((await t.submitter.submit(t.root, API, PR, shown({ event: 'APPROVE', body: 'Body.', comments }))).outcome).toBe('refused')
    expect(t.writes()).toEqual([])
  })

  it('GitHub refuses with 422: its reason in the answer, the draft stays, the next Submit posts without looking first', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]), { reviews: { status: 422, message: 'User can only have one pending review per pull request' } })
    const input = shown({ event: 'COMMENT', body: 'Body.', comments })
    const refused = await s.submitter.submit(s.root, API, PR, input)
    expect(refused.outcome).toBe('failed')
    expect(refused.reason).toContain('User can only have one pending review per pull request')
    expect(refused.reason).not.toContain(UNCONFIRMED)
    expect(s.onDisk().state).toBe('draft')
    writeFileSync(join(s.gh.dir, 'reviews.json'), '{}')
    expect((await s.submitter.submit(s.root, API, PR, input)).outcome).toBe('submitted')
    expect(s.gh.calls().some((args) => args[1]?.includes('/reviews?'))).toBe(false)
  })

  it('an Agent review: the event is the one the person chose, a comment removed in the dialog is not posted', { timeout: ms(60_000) }, async () => {
    const mine = on(2, 'Mine.')
    const kept = on(3, 'The agent: this name reads better as total.')
    const removed = on(4, 'The agent: a comment the person removed.')
    const draft = draftOf(
      [
        { comment: mine, by: 'person' },
        { comment: kept, by: 'agent' },
        { comment: removed, by: 'agent' },
      ],
      { suggestedEvent: 'REQUEST_CHANGES', agent: { sessionId: 's-1', state: 'done' }, bodyBy: 'agent', payload: { body: 'The agent summary.', comments: [mine, kept, removed] } },
    )
    const s = await setup(draft)
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: 'The agent summary.', comments: [mine, kept] }))
    expect(answer.outcome, answer.reason ?? '').toBe('submitted')
    const request = s.posted()[0]!.request
    expect(request.event).toBe('COMMENT')
    expect((request.comments as ReviewComment[]).map((each) => each.body)).toEqual(['Mine.', 'The agent: this name reads better as total.'])
    expect(s.onDisk().payload.comments.map((each) => each.body)).toEqual(['Mine.', 'The agent: this name reads better as total.'])
  })

  it("the Team reviewer's lint.json of the Project checks a draft the person wrote, which names no tiers: it goes; a word it forbids is a finding", { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]))
    const rules = join(s.profileDir, 'state', 'human-review', 'lint.json')
    mkdirSync(dirname(rules), { recursive: true })
    writeFileSync(rules, JSON.stringify({ schema: 1, tiers: { nit: { max_chars: 200 }, blocker: { max_chars: 1200 } }, forbidden: ['blammo'] }))
    const found = await s.submitter.check(s.root, API, PR, { event: 'COMMENT', body: 'This blammo of a function.', comments })
    expect(found.reason).toBeNull()
    expect(found.findings.join('\n')).toContain('forbidden "blammo"')
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: 'Fine apart from the retry.', comments }))
    expect(answer.outcome, answer.reason ?? '').toBe('submitted')
    expect(s.writes()).toHaveLength(1)
  })

  it('nothing while the Session of an Agent review writes the draft', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'agent' }], { agent: { sessionId: 's-1', state: 'writing' } }))
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments }))
    expect(answer.outcome).toBe('refused')
    expect(answer.reason).toBe(AGENT_WRITING)
    expect(s.gh.calls()).toEqual([])
  })

  it('a text the dialog showed that the file does not hold is refused: what goes is what the file has', { timeout: ms(60_000) }, async () => {
    const s = await setup(draftOf([{ comment: on(2, 'One.'), by: 'person' }]))
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments: [on(2, 'One, edited elsewhere.')] }))
    expect(answer.outcome).toBe('refused')
    expect(s.gh.calls()).toEqual([])
  })

  it('a comment not on a changed line of the diff GitHub has, or a range across hunks: refused, no POST', { timeout: ms(60_000) }, async () => {
    for (const comment of [on(10, 'Off the diff.'), on(23, 'Across hunks.', { start_line: 3, start_side: 'RIGHT' }), on(2, 'Another file.', { path: 'src/other.ts' }), on(5, 'Old side past its lines.', { side: 'LEFT' })]) {
      const s = await setup(draftOf([{ comment, by: 'agent' }]))
      const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments: [comment] }))
      expect(answer.outcome, JSON.stringify(comment)).toBe('refused')
      expect(answer.reason).toContain(`${comment.path}:`)
      expect(s.writes()).toEqual([])
    }
  })

  it('no account named in the Profile: refused before any gh call', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]), {}, { account: async () => null })
    const answer = await s.submitter.submit(s.root, API, PR, shown({ event: 'COMMENT', body: '', comments }))
    expect(answer).toMatchObject({ outcome: 'refused', reason: NO_ACCOUNT })
    expect(s.gh.calls()).toEqual([])
  })

  it('through the channels: the draft, the check and a refused Submit post nothing; Submit posts once', { timeout: ms(60_000) }, async () => {
    const comments = [on(2, 'One.')]
    const s = await setup(draftOf([{ comment: comments[0]!, by: 'person' }]))
    const pull = { projectId: PROJECT, repo: API, number: PR }
    ok(await s.call('prReview.draft', pull))
    ok(await s.call('prReview.check', { ...pull, event: 'COMMENT', body: '', comments }))
    expect(ok(await s.call<PrReviewSubmitAnswer>('prReview.submit', { ...pull, ...shown({ event: 'COMMENT', body: '', comments, head: MOVED }) })).outcome).toBe('refused')
    expect(s.writes()).toEqual([])
    // A refused Submit leaves the PR inbox as it is; a review GitHub has makes it read the PR again.
    expect(s.refreshed).toEqual([])
    expect(ok(await s.call<PrReviewSubmitAnswer>('prReview.submit', { ...pull, ...shown({ event: 'COMMENT', body: '', comments }) })).outcome).toBe('submitted')
    expect(s.writes()).toHaveLength(1)
    expect(s.refreshed).toEqual([`${API}#${PR}`])
  })

  it('Submit and its check are `local`: a Linked machine never reaches them', async () => {
    expect([prReviewSubmit.access, prReviewCheck.access]).toEqual(['local', 'local'])
    const adapter = await createLinkIpc({ modules: { './pr-review.ts': async () => prReviewHandlers({ drafts: () => ({}) as never, root: () => '/nowhere', submitter: () => ({}) as never }) }, isLinked: () => true })
    expect(adapter.channels()).toEqual([])
  })
})
