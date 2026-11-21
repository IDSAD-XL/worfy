// The draft of a review (worfy-pr-review ticket 07, src/main/github/pr-review-draft.ts) through the `prReview` IPC
// handlers, over a temporary Profile folder:
// - a change lands through a temporary file and a rename: a write broken half way leaves the file as it was, and no
//   temporary file behind;
// - at most one write in 500 ms per draft: a burst of changes is one write now and one after the interval, and every
//   answer shows all of them at once;
// - Discard removes the file and the changes waiting for it; a draft being submitted is not discarded;
// - a submitted draft is kept 30 days, then removed at the first look at the Project's drafts in a run of worfy;
// - a Linked machine, at any access level, is refused every `prReview.*` channel before the handler.
// - Start review (worfy-pr-review ticket 09, `prReview.start`): a PR without a draft gets one on its head, with the files
//   the account marked Viewed on github.com (`viewerViewedState`, Q3 (a)) — read once, by one GraphQL query, over the gh
//   stand-in (test/fixtures/gh/gh-stub.mjs), which fails the test on any `--method` and any `mutation`; a PR with a draft
//   reads nothing.
// The race of main with bin/pr-review-draft is ticket 08's. Apart from Start review nothing reaches GitHub: no gh is
// given at all.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, utimesSync, writeFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrReviewDrafts, reviewDraftFilePath, SUBMITTED_KEEP_MS, WRITE_INTERVAL_MS, type PrReviewDraftsOptions } from '../../src/main/github/pr-review-draft'
import { appUrlMatcher, registerIpc, type IpcMainLike, type ModuleLoader } from '../../src/main/ipc/index'
import { prReviewHandlers } from '../../src/main/ipc/pr-review'
import { createLinkIpc, LinkPeer } from '../../src/main/link/ipc-adapter'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { LISTING_WAIT_MS, prReviewDeleteComment, prReviewDiscard, prReviewDraft, prReviewDrafts, prReviewSaveComment, prReviewSetViewed, prReviewStart, TEXTS_LOCKED, UNCONFIRMED, type PrReviewDraftAnswer, type ReviewDraft } from '../../src/shared/ipc/pr-review'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'
import { ghWorld, type GhWorld } from './gh-world'

const API = 'demo-org/api'
const PR = 118
const HEAD = 'a1b2c3d4e5f6'
const PROJECT = 'demo-0000000d'
const DAY = 24 * 60 * 60 * 1000

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

interface Setup {
  profileDir: string
  file: string
  drafts: PrReviewDrafts
  /** When each write of a draft file was renamed into place. */
  writes: number[]
  call: <T>(channel: string, input: unknown) => Promise<IpcResult<T>>
  /** The draft file as it is now; null without one. */
  onDisk: () => ReviewDraft | null
}

async function setup(over: Partial<PrReviewDraftsOptions> = {}, world?: GhWorld): Promise<Setup> {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-review-')))
  temps.push(base)
  const root = join(base, 'project')
  const profileDir = join(base, 'profile')
  mkdirSync(root, { recursive: true })
  const writes: number[] = []
  const drafts = new PrReviewDrafts({ profileDir: async () => ({ dir: profileDir, reason: null }), wrote: () => void writes.push(Date.now()), warn: () => undefined, ...over })
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  await registerIpc(ipc, { modules: { './pr-review.ts': async () => prReviewHandlers({ drafts: () => drafts, root: () => root, ...(world === undefined ? {} : { github: () => (args) => world.run(args, root) }) }) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  const call = async <T,>(channel: string, input: unknown) => (await handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)!({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<T>
  const file = reviewDraftFilePath(profileDir, API, PR)
  return { profileDir, file, drafts, writes, call, onDisk: () => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ReviewDraft) : null) }
}

function ok<T>(result: IpcResult<T>): T {
  if (!result.ok) throw new Error(`refused: ${result.error}`)
  return result.value
}

const pull = { projectId: PROJECT, repo: API, number: PR }
const comment = (line: number, body: string) => ({ path: 'src/upload.ts', line, side: 'RIGHT', body })
const save = (line: number, body: string) => ({ ...pull, head: HEAD, comment: comment(line, body), anchor: `line ${line}` })

describe('the draft through the prReview channels', () => {
  it('no draft: none, and nothing is written by a look', async () => {
    const s = await setup()
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.draft', pull))).toEqual({ repo: API, pr: PR, draft: null, problem: null })
    expect(ok(await s.call('prReview.drafts', { projectId: PROJECT }))).toEqual({ drafts: [], problem: null })
    expect(existsSync(join(s.profileDir, 'state'))).toBe(false)
  })

  it('a first comment creates the draft on the head of the PR, in state/pr-review/, the person as its author', async () => {
    const s = await setup()
    const answer = ok(await s.call<PrReviewDraftAnswer>('prReview.saveComment', save(12, 'Why three tries?')))
    expect(s.file).toBe(join(s.profileDir, 'state', 'pr-review', 'demo-org-api-118.json'))
    expect(s.onDisk()).toEqual({ schema: 1, repo: API, pr: PR, startedOn: HEAD, payload: { body: '', comments: [comment(12, 'Why three tries?')] }, anchors: [{ text: 'line 12', by: 'person' }], viewed: {}, state: 'draft' })
    expect(answer.draft).toEqual(s.onDisk())
    expect(ok(await s.call('prReview.drafts', { projectId: PROJECT }))).toEqual({ drafts: [{ repo: API, pr: PR, comments: 1, startedOn: HEAD, state: 'draft' }], problem: null })
  })

  it('a change, Viewed and a delete land in the file; a delete of a comment that is not there is refused', async () => {
    // A clock that never moves would hold every write after the first; this one is moved by hand.
    let now = 0
    const t = await setup({ now: () => now })
    for (const [channel, input] of [
      ['prReview.saveComment', save(12, 'Why three tries?')],
      ['prReview.saveComment', { ...save(12, 'Why not two?'), ref: { index: 0, path: 'src/upload.ts', body: 'Why three tries?' } }],
      ['prReview.setViewed', { ...pull, head: HEAD, path: 'src/upload.ts', blob: 'b10b5a' }],
      ['prReview.saveComment', save(30, 'And here.')],
      ['prReview.deleteComment', { ...pull, ref: { index: 1, path: 'src/upload.ts', body: 'And here.' } }],
    ] as const) {
      now += WRITE_INTERVAL_MS
      ok(await t.call(channel, input))
    }
    expect(t.onDisk()).toMatchObject({ payload: { comments: [comment(12, 'Why not two?')] }, anchors: [{ text: 'line 12', by: 'person' }], viewed: { 'src/upload.ts': 'b10b5a' } })
    expect(t.writes).toHaveLength(5)
    expect(await t.call('prReview.deleteComment', { ...pull, ref: { index: 0, path: 'src/upload.ts', body: 'Gone.' } })).toEqual({
      ok: false,
      error: 'prReview.deleteComment failed: The comment changed meanwhile (an Agent review writes the draft): look at it again',
    })
  })
})

describe('Start review: the files Viewed on github.com, read once and only read', () => {
  const FILES = [
    { path: 'src/upload.ts', blob: 'b10b5a' },
    { path: 'src/old.ts', blob: 'b20b5a' },
    { path: 'README.md', blob: 'b30b5a' },
  ]
  const start = { ...pull, head: HEAD, files: FILES }

  /** The stand-in with the PR whose files the account marked on github.com: one Viewed, one Viewed before a change since, one not. */
  function world(): GhWorld {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-review-gh-')))
    temps.push(dir)
    const made = ghWorld(join(dir, 'gh'), { accounts: [] })
    writeFileSync(join(made.dir, 'graphql.json'), JSON.stringify({ viewer: 'dev-me', pulls: [{ repo: API, number: PR, updatedAt: '2026-11-20T10:00:00Z', headRefOid: HEAD, viewed: { 'src/upload.ts': 'VIEWED', 'src/old.ts': 'DISMISSED', 'README.md': 'UNVIEWED' } }] }))
    return made
  }

  /** No call of the stand-in writes: no method but GET, no field of a REST call, no GraphQL mutation. */
  const readsOnly = (calls: string[][]): void => {
    for (const args of calls) {
      expect(args.slice(0, 2)).toEqual(['api', 'graphql'])
      expect(args.some((arg) => /^(?:--method|-X)/u.test(arg))).toBe(false)
      expect(args.some((arg) => /\bmutation\b/u.test(arg))).toBe(false)
    }
  }

  it('a PR without a draft: one GraphQL read; the draft starts on the head with the files marked VIEWED at their blob', async () => {
    const gh = world()
    const s = await setup({}, gh)
    const answer = ok(await s.call<PrReviewDraftAnswer>('prReview.start', start))
    expect(s.onDisk()).toEqual({ schema: 1, repo: API, pr: PR, startedOn: HEAD, payload: { body: '', comments: [] }, anchors: [], viewed: { 'src/upload.ts': 'b10b5a' }, state: 'draft' })
    expect(answer).toEqual({ repo: API, pr: PR, draft: s.onDisk(), problem: null })
    expect(gh.calls()).toHaveLength(1)
    expect(gh.calls()[0]!.join(' ')).toContain('viewerViewedState')
    readsOnly(gh.calls())
  })

  it('once: a second Start review, and two at once, read GitHub no more; the marks of the person stay', async () => {
    const gh = world()
    const s = await setup({}, gh)
    await Promise.all([s.call('prReview.start', start), s.call('prReview.start', start)])
    ok(await s.call('prReview.setViewed', { ...pull, head: HEAD, path: 'src/upload.ts', blob: null }))
    const again = ok(await s.call<PrReviewDraftAnswer>('prReview.start', start))
    expect(again.draft?.viewed).toEqual({})
    expect(gh.calls()).toHaveLength(1)
    readsOnly(gh.calls())
  })

  it('a PR with a draft already (a comment, an Agent review): nothing is read, the draft stays as it is', async () => {
    const gh = world()
    const s = await setup({}, gh)
    ok(await s.call('prReview.saveComment', save(12, 'Why three tries?')))
    const before = readFileSync(s.file, 'utf8')
    const answer = ok(await s.call<PrReviewDraftAnswer>('prReview.start', { ...start, head: 'ffeeddccbbaa' }))
    expect(answer.draft?.startedOn).toBe(HEAD)
    expect(gh.calls()).toEqual([])
    expect(readFileSync(s.file, 'utf8')).toBe(before)
  })

  it('the comments of Review mode (worfy-pr-review ticket 10) — new, on a range, changed, an agent\'s made the person\'s, moved, deleted — and Discard: no call to GitHub at all', async () => {
    const gh = world()
    const s = await setup({}, gh)
    ok(await s.call('prReview.start', start))
    const read = gh.calls().length
    ok(await s.call('prReview.saveComment', save(12, 'Why three tries?')))
    ok(await s.call('prReview.saveComment', { ...pull, head: HEAD, comment: { path: 'src/upload.ts', line: 14, side: 'RIGHT', start_line: 13, start_side: 'RIGHT', body: '```suggestion\nconst TRIES = 2\nconst WAIT = 100\n```' }, anchor: 'line 13\nline 14' }))
    ok(await s.call('prReview.saveComment', { ...save(12, 'Why not two?'), ref: { index: 0, path: 'src/upload.ts', body: 'Why three tries?' } }))
    ok(await s.call('prReview.saveComment', { ...save(30, 'Why not two?'), ref: { index: 0, path: 'src/upload.ts', body: 'Why not two?' } }))
    const left = ok(await s.call<PrReviewDraftAnswer>('prReview.deleteComment', { ...pull, ref: { index: 1, path: 'src/upload.ts', body: '```suggestion\nconst TRIES = 2\nconst WAIT = 100\n```' } }))
    expect(left.draft?.payload.comments).toEqual([{ path: 'src/upload.ts', line: 30, side: 'RIGHT', body: 'Why not two?' }])
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.discard', pull)).draft).toBeNull()
    expect(s.onDisk()).toBeNull()
    expect(gh.calls()).toHaveLength(read)
    readsOnly(gh.calls())
  })

  it('GitHub does not answer: the draft starts without marks, and the read is not tried again', async () => {
    const gh = world()
    writeFileSync(join(gh.dir, 'offline'), '')
    const s = await setup({}, gh)
    const answer = ok(await s.call<PrReviewDraftAnswer>('prReview.start', start))
    expect(answer.draft).toMatchObject({ startedOn: HEAD, viewed: {} })
    ok(await s.call('prReview.start', start))
    expect(gh.calls()).toHaveLength(1)
  })

  it('without a reader of GitHub (a test build): the draft starts without marks', async () => {
    const s = await setup()
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.start', start)).draft).toMatchObject({ startedOn: HEAD, viewed: {} })
  })
})

describe('a write goes through a temporary file and a rename', () => {
  it('a write broken half way leaves the file as it was, no temporary file behind; the change is taken, told as not written yet, and written once', async () => {
    let broken = false
    let now = 0
    const s = await setup({
      now: () => now,
      writeFile: async (file, text) => {
        if (!broken) return writeFile(file, text)
        // Half the text, then the process "dies" mid-write.
        await writeFile(file, text.slice(0, Math.floor(text.length / 2)))
        throw new Error('the disk went away')
      },
    })
    ok(await s.call('prReview.saveComment', save(12, 'Why three tries?')))
    const before = readFileSync(s.file, 'utf8')
    broken = true
    now += WRITE_INTERVAL_MS
    const answer = ok(await s.call<PrReviewDraftAnswer>('prReview.saveComment', save(30, 'And here.')))
    expect(answer.draft?.payload.comments.map((each) => each.body)).toEqual(['Why three tries?', 'And here.'])
    expect(answer.problem).toBe('The review draft is not written yet: the disk went away. worfy writes it with the next change, and when it quits')
    expect(readFileSync(s.file, 'utf8')).toBe(before)
    expect(readdirSync(dirname(s.file))).toEqual(['demo-org-api-118.json'])
    // The view has the comment once; the next write saves it once.
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.draft', pull)).draft?.payload.comments).toHaveLength(2)
    broken = false
    now += WRITE_INTERVAL_MS
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.setViewed', { ...pull, head: HEAD, path: 'src/upload.ts', blob: 'b10b5a' })).problem).toBeNull()
    expect(s.onDisk()?.payload.comments.map((each) => each.body)).toEqual(['Why three tries?', 'And here.'])
  })

  it('the changes waiting are kept when the file cannot be read at the time of the write, and written once it can', async () => {
    let now = 0
    const s = await setup({ now: () => now })
    ok(await s.call('prReview.saveComment', save(12, 'First.')))
    ok(await s.call('prReview.saveComment', save(30, 'Second.')))
    const good = readFileSync(s.file, 'utf8')
    // Another writer leaves the file half written for a moment.
    writeFileSync(s.file, good.slice(0, 20))
    now += WRITE_INTERVAL_MS
    await expect(s.drafts.flush()).rejects.toThrow(/not JSON/u)
    writeFileSync(s.file, good)
    await s.drafts.flush()
    expect(s.onDisk()?.payload.comments.map((each) => each.body)).toEqual(['First.', 'Second.'])
  })

  it('a write keeps what another writer put into the file meanwhile and fields this version does not know', async () => {
    let now = 0
    const s = await setup({ now: () => now })
    ok(await s.call('prReview.saveComment', save(12, 'Why three tries?')))
    // An Agent review adds a comment and a field of its own, by a rename as bin/pr-review-draft will.
    const agent = { ...s.onDisk()!, later: { kept: true } }
    agent.payload.comments.push(comment(40, 'From the agent.') as ReviewDraft['payload']['comments'][number])
    agent.anchors.push({ text: 'line 40', by: 'agent' })
    writeFileSync(`${s.file}.agent`, JSON.stringify(agent))
    renameSync(`${s.file}.agent`, s.file)
    now += WRITE_INTERVAL_MS
    ok(await s.call('prReview.setViewed', { ...pull, head: HEAD, path: 'src/upload.ts', blob: 'b10b5a' }))
    expect(s.onDisk()).toMatchObject({ later: { kept: true }, anchors: [{ by: 'person' }, { by: 'agent' }], viewed: { 'src/upload.ts': 'b10b5a' } })
  })
})

describe('at most one write in 500 ms', () => {
  it('a burst of five changes: one write now, one after the interval with the rest; every answer shows them all', async () => {
    const s = await setup()
    const started = Date.now()
    for (let i = 1; i <= 5; i++) {
      const answer = ok(await s.call<PrReviewDraftAnswer>('prReview.saveComment', save(i * 10, `Comment ${i}.`)))
      expect(answer.draft?.payload.comments).toHaveLength(i)
    }
    // Only the first is in the file while the interval runs (the loop is far shorter than 500 ms on any runner; if not, the check below still holds).
    if (Date.now() - started < WRITE_INTERVAL_MS) expect(s.onDisk()?.payload.comments).toHaveLength(1)
    await vi.waitFor(() => expect(s.onDisk()?.payload.comments).toHaveLength(5), { timeout: ms(5_000), interval: 50 })
    expect(s.writes.length).toBeLessThanOrEqual(2)
    for (let i = 1; i < s.writes.length; i++) expect(s.writes[i]! - s.writes[i - 1]!).toBeGreaterThanOrEqual(WRITE_INTERVAL_MS)
  })

  it('a quit between the rename and the removal of the temporary file writes nothing twice', async () => {
    let now = 0
    let quitting = false
    const holder: { drafts?: PrReviewDrafts } = {}
    const s = await setup({
      now: () => now,
      removeTemp: async (path) => {
        // worfy quits (will-quit) while the write still removes its temporary file.
        if (quitting) holder.drafts!.flushSync()
        await rm(path, { force: true })
      },
    })
    holder.drafts = s.drafts
    ok(await s.call('prReview.saveComment', save(12, 'A.')))
    quitting = true
    now += WRITE_INTERVAL_MS
    ok(await s.call('prReview.saveComment', save(30, 'B.')))
    expect(s.onDisk()?.payload.comments.map((each) => each.body)).toEqual(['A.', 'B.'])
  })

  it('what waits is written at quit, synchronously', async () => {
    const now = 0
    const s = await setup({ now: () => now })
    ok(await s.call('prReview.saveComment', save(12, 'First.')))
    ok(await s.call('prReview.saveComment', save(30, 'Second.')))
    expect(s.onDisk()?.payload.comments).toHaveLength(1)
    s.drafts.flushSync()
    expect(s.onDisk()?.payload.comments).toHaveLength(2)
    expect(readdirSync(dirname(s.file))).toEqual(['demo-org-api-118.json'])
  })
})

describe('Discard', () => {
  it('removes the file and the changes waiting for it: nothing comes back after the interval', async () => {
    const s = await setup()
    ok(await s.call('prReview.saveComment', save(12, 'First.')))
    ok(await s.call('prReview.saveComment', save(30, 'Second.')))
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.discard', pull))).toEqual({ repo: API, pr: PR, draft: null, problem: null })
    expect(existsSync(s.file)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, WRITE_INTERVAL_MS + 200))
    expect(existsSync(s.file)).toBe(false)
    expect(ok(await s.call('prReview.drafts', { projectId: PROJECT }))).toEqual({ drafts: [], problem: null })
  })

  it('a review being submitted is not discarded', async () => {
    const s = await setup()
    ok(await s.call('prReview.saveComment', save(12, 'First.')))
    writeFileSync(s.file, JSON.stringify({ ...s.onDisk()!, state: 'submitting', submittingAt: new Date().toISOString() }))
    expect(await s.call('prReview.discard', pull)).toEqual({ ok: false, error: 'prReview.discard failed: This review is being submitted: it is not discarded' })
    expect(existsSync(s.file)).toBe(true)
  })

  it('a Submit GitHub did not confirm, or a mark `submitting` older than the wait (worfy quit while it ran), is discarded: the lookup may fail for good', async () => {
    const s = await setup()
    ok(await s.call('prReview.saveComment', save(12, 'First.')))
    const draft = s.onDisk()!
    writeFileSync(s.file, JSON.stringify({ ...draft, error: `${UNCONFIRMED}: gh: Not Found (HTTP 404)`, submittingAt: new Date().toISOString() }))
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.discard', pull)).draft).toBeNull()
    expect(existsSync(s.file)).toBe(false)
    const t = await setup()
    ok(await t.call('prReview.saveComment', save(12, 'First.')))
    writeFileSync(t.file, JSON.stringify({ ...t.onDisk()!, state: 'submitting', submittingAt: new Date(Date.now() - LISTING_WAIT_MS - 60_000).toISOString() }))
    expect(ok(await t.call<PrReviewDraftAnswer>('prReview.discard', pull)).draft).toBeNull()
    expect(existsSync(t.file)).toBe(false)
  })

  it.each([
    ['half written', '{"schema": 1, "repo": "demo-org/api", "pr": 118, "payl'],
    ['of another shape', JSON.stringify({ schema: 1, repo: API, pr: PR, comments: 'none' })],
  ])('removes a file that is not a draft any more (%s), which nothing else can change or remove', async (_, text) => {
    const s = await setup()
    mkdirSync(dirname(s.file), { recursive: true })
    writeFileSync(s.file, text)
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.draft', pull)).problem).toMatch(/not JSON|another shape/u)
    expect(ok(await s.call<PrReviewDraftAnswer>('prReview.discard', pull))).toEqual({ repo: API, pr: PR, draft: null, problem: null })
    expect(existsSync(s.file)).toBe(false)
  })

  it('does not remove a draft of another PR found at its path', async () => {
    const s = await setup()
    mkdirSync(dirname(s.file), { recursive: true })
    writeFileSync(s.file, JSON.stringify({ schema: 1, repo: 'demo-org/api-x', pr: 7, startedOn: HEAD, payload: { body: '', comments: [] }, anchors: [], viewed: {}, state: 'draft' }))
    expect(await s.call('prReview.discard', pull)).toEqual({ ok: false, error: `prReview.discard failed: The review draft ${s.file} is of demo-org/api-x#7` })
    expect(existsSync(s.file)).toBe(true)
  })
})

describe('a submitted draft is kept 30 days', () => {
  it('older ones go at the first look at the Project drafts in a run, by submittedAt, else by the time of the file', async () => {
    const now = Date.UTC(2026, 10, 20)
    const s = await setup({ now: () => now })
    const dir = dirname(s.file)
    mkdirSync(dir, { recursive: true })
    const draft = (pr: number, over: Record<string, unknown>) => {
      const file = reviewDraftFilePath(s.profileDir, API, pr)
      writeFileSync(file, JSON.stringify({ schema: 1, repo: API, pr, startedOn: HEAD, payload: { body: '', comments: [] }, anchors: [], viewed: {}, state: 'submitted', ...over }))
      return file
    }
    const old = draft(1, { submittedAt: new Date(now - SUBMITTED_KEEP_MS - DAY).toISOString(), reviewUrl: 'https://github.com/demo-org/api/pull/1#pullrequestreview-1' })
    const recent = draft(2, { submittedAt: new Date(now - SUBMITTED_KEEP_MS + DAY).toISOString() })
    const byFileTime = draft(3, {})
    utimesSync(byFileTime, new Date(now - SUBMITTED_KEEP_MS - DAY), new Date(now - SUBMITTED_KEEP_MS - DAY))
    const openOld = draft(4, { state: 'draft' })
    utimesSync(openOld, new Date(now - 90 * DAY), new Date(now - 90 * DAY))
    const answer = ok(await s.call<{ drafts: { pr: number }[] }>('prReview.drafts', { projectId: PROJECT }))
    expect(answer.drafts.map((row) => row.pr)).toEqual([2, 4])
    expect([old, recent, byFileTime, openOld].map((file) => existsSync(file))).toEqual([false, true, false, true])
  })
})

describe('a Submit GitHub did not confirm keeps its texts in main too', () => {
  it('saveComment and deleteComment are refused; the file stays as it is', async () => {
    let now = 0
    const s = await setup({ now: () => now })
    ok(await s.call('prReview.saveComment', save(12, 'First.')))
    const locked = { ...s.onDisk()!, error: `${UNCONFIRMED}: gh: Bad Gateway (HTTP 502)`, submittingAt: new Date().toISOString() }
    writeFileSync(s.file, JSON.stringify(locked))
    for (const [channel, input] of [
      ['prReview.saveComment', save(30, 'Another.')],
      ['prReview.saveComment', { ...save(12, 'Changed.'), ref: { index: 0, path: 'src/upload.ts', body: 'First.' } }],
      ['prReview.deleteComment', { ...pull, ref: { index: 0, path: 'src/upload.ts', body: 'First.' } }],
    ] as const) {
      now += WRITE_INTERVAL_MS
      const answer = await s.call(channel, input)
      expect(answer.ok).toBe(false)
      expect(answer.ok ? '' : answer.error).toContain(TEXTS_LOCKED)
    }
    expect(s.onDisk()).toEqual(locked)
  })
})

describe('a Linked machine', () => {
  const LINKED = '66666666-6666-4666-8666-666666666666'

  it('every prReview channel is `local`', () => {
    expect([prReviewDraft, prReviewSaveComment, prReviewDeleteComment, prReviewSetViewed, prReviewDiscard, prReviewDrafts, prReviewStart].map((channel) => channel.access)).toEqual(Array(7).fill('local'))
  })

  it.each(['all', 'read'] as const)('with access %s: every prReview channel is refused before the handler; nothing is read or written', async (level) => {
    const s = await setup()
    ok(await s.call('prReview.saveComment', save(12, 'Why three tries?')))
    const before = readFileSync(s.file, 'utf8')
    const spy = { draft: vi.fn(), saveComment: vi.fn(), deleteComment: vi.fn(), setViewed: vi.fn(), discard: vi.fn(), list: vi.fn(), start: vi.fn() }
    const modules: Record<string, ModuleLoader> = { './pr-review.ts': async () => prReviewHandlers({ drafts: () => spy as never, root: () => '/nowhere' }) }
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === LINKED })
    expect(adapter.channels()).toEqual([])
    const peer = new LinkPeer({ machineId: LINKED, describe: () => LINKED, push: () => undefined, local: () => ({ id: 'beta', name: 'Beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess(level)
    const ref = { index: 0, path: 'src/upload.ts', body: 'Why three tries?' }
    for (const [channel, input] of [
      ['prReview.draft', pull],
      ['prReview.saveComment', save(30, 'x')],
      ['prReview.deleteComment', { ...pull, ref }],
      ['prReview.setViewed', { ...pull, head: HEAD, path: 'src/upload.ts', blob: 'b10b5a' }],
      ['prReview.discard', pull],
      ['prReview.drafts', { projectId: PROJECT }],
      ['prReview.start', { ...pull, head: HEAD, files: [{ path: 'src/upload.ts', blob: 'b10b5a' }] }],
    ] as const)
      expect(await adapter.call(peer, channel, input, 'Beta')).toEqual({ ok: false, error: `${channel}: not open to Linked machines` })
    for (const each of Object.values(spy)) expect(each).not.toHaveBeenCalled()
    expect(readFileSync(s.file, 'utf8')).toBe(before)
  })
})
