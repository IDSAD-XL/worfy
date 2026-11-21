// The draft of a review of someone else's PR (worfy-pr-review ticket 07): one file per PR on this machine,
// `<Profile folder>/state/pr-review/<owner>-<name>-<N>.json`, beside the drafts of replies (state/pr-inbox/drafts/,
// ADR-0105, point 6) and out of every repository (ADR-0005). Its shape — src/shared/ipc/pr-review.ts: `payload` is
// the body of GitHub's POST .../pulls/{n}/reviews as review-draft-lint checks it, the rest belongs to worfy.
//
// - The pure part: a new draft, a comment of the person (which makes it theirs, `by: 'person'`), a delete, Viewed,
//   the payload to lint and send, and finding the commented lines again after a new head (`reanchor`).
// - The file: main writes each change through a temporary file beside it and a rename, so a reader never sees half a
//   file; at most once in WRITE_INTERVAL_MS per file — the changes of a burst wait and go out in the next write. A
//   write reads the file again and applies the waiting changes to what is there, so a draft an Agent review wrote
//   meanwhile (bin/pr-review-draft, ticket 08) is changed, not overwritten. Every answer shows the file with the
//   waiting changes applied. Quitting writes what waits (`flushSync`).
// - The lock (ticket 08): the Session of an Agent review writes the same file through bin/pr-review-draft, another
//   process. Each writer — main here, the script there — holds `<file>.lock`, a file created only when it is not there
//   yet, for its read, change and rename, so neither drops a change of the other. A lock older than LOCK_STALE_MS was
//   left by a writer that died, and is taken over. A write that cannot get the lock in LOCK_WAIT_MS keeps its changes
//   waiting for the next write.
// - A draft whose Submit may be on GitHub (submitPending, ADR-0112, point 6) keeps the texts that went: a comment is
//   neither saved nor deleted (TEXTS_LOCKED) until the next Submit finds the review or posts them.
// - Discard removes the file; a mark `submitting` younger than LISTING_WAIT_MS stays (its POST may still run). A
//   submitted draft is kept SUBMITTED_KEEP_MS (the link to the review) and removed at the first look at the Project's
//   drafts after worfy starts.
// - Start review (ticket 09): a PR without a draft gets one, with the files the account marked Viewed on github.com —
//   one GraphQL read (`viewerViewedState`, viewedOnGithub), once: the draft is there after it, and a second Start review
//   of the same PR, at once or later, reads nothing. Nothing is written to GitHub, ever: no `markFileAsViewed` (Q3 (a)).
// - Apart from that read nothing here reaches GitHub.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  LISTING_WAIT_MS,
  markAge,
  reviewDraftSchema,
  submitPending,
  TEXTS_LOCKED,
  type AgentReviewState,
  type PrReviewDraftAnswer,
  type PrReviewDraftRow,
  type ReviewComment,
  type ReviewCommentRef,
  type ReviewDraft,
  type ReviewEvent,
} from '../../shared/ipc/pr-review'
import { removeFile } from '../storage/remove'

/** At most one write of a draft file in this many milliseconds. */
export const WRITE_INTERVAL_MS = 500
/** How long a submitted draft is kept. */
export const SUBMITTED_KEEP_MS = 30 * 24 * 60 * 60 * 1000
/** How long a writer waits for the lock of a draft file (bin/pr-review-draft waits as long). */
export const LOCK_WAIT_MS = 15_000
/** A lock this old was left by a writer that died; bin/pr-review-draft has the same number. */
export const LOCK_STALE_MS = 10_000
/** How long a Profile folder found is taken as it is, as for the drafts of replies. */
const FOLDER_TTL_MS = 30_000
const FILE = /^[A-Za-z0-9-]+-[A-Za-z0-9._-]+-\d+\.json$/u

/** A refusal the view shows as it is. */
export class ReviewDraftRefusal extends Error {}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function reviewDraftFilePath(profileDir: string, repo: string, pr: number): string {
  const [owner, name] = repo.split('/')
  return join(profileDir, 'state', 'pr-review', `${owner}-${name}-${pr}.json`)
}

// ── the pure part ──────────────────────────────────────────────────────────

export function newReviewDraft(repo: string, pr: number, head: string): ReviewDraft {
  return { schema: 1, repo, pr, startedOn: head, payload: { body: '', comments: [] }, anchors: [], viewed: {}, state: 'draft' }
}

function editable(draft: ReviewDraft): ReviewDraft {
  if (draft.state !== 'draft') throw new ReviewDraftRefusal(`This review is ${draft.state}: it is not changed any more`)
  return structuredClone(draft)
}

/** The draft, to change its texts: not while a Submit of them may be on GitHub (ADR-0112, point 6). */
function textsEditable(draft: ReviewDraft): ReviewDraft {
  if (submitPending(draft)) throw new ReviewDraftRefusal(TEXTS_LOCKED)
  return editable(draft)
}

/** The place of the comment `ref` names: of its file and with its text, the nearest to its old place. */
function locate(draft: ReviewDraft, ref: ReviewCommentRef): number {
  let found = -1
  draft.payload.comments.forEach((comment, index) => {
    if (comment.path !== ref.path || comment.body !== ref.body) return
    if (found === -1 || Math.abs(index - ref.index) < Math.abs(found - ref.index)) found = index
  })
  if (found === -1) throw new ReviewDraftRefusal('The comment changed meanwhile (an Agent review writes the draft): look at it again')
  return found
}

/** How many lines a comment covers: `start_line`..`line`, or `line` alone. */
const sizeOf = (comment: ReviewComment): number => comment.line - (comment.start_line ?? comment.line) + 1

const LINE_END = /\r?\n/u

/** The lines of `text` as many as `size` asks: a line end at the very end is not a line of its own when it is one too many. */
function linesOf(text: string, size: number): string[] {
  const lines = text.split(LINE_END)
  return lines.length === size + 1 && lines.at(-1) === '' ? lines.slice(0, -1) : lines
}

/** A comment of the person, new (no `ref`) or a change of `ref`; either way it is the person's now. `anchor` has exactly its lines. */
export function putComment(draft: ReviewDraft, input: { ref?: ReviewCommentRef | undefined; comment: ReviewComment; anchor: string }): ReviewDraft {
  const next = textsEditable(draft)
  const size = sizeOf(input.comment)
  const lines = linesOf(input.anchor, size)
  if (lines.length !== size) throw new ReviewDraftRefusal(`The text of the commented lines has ${lines.length} lines, the comment covers ${size} lines`)
  const text = lines.length === input.anchor.split(LINE_END).length ? input.anchor : input.anchor.replace(/\r?\n$/u, '')
  const anchor = { text, by: 'person' as const }
  if (input.ref === undefined) {
    next.payload.comments.push(input.comment)
    next.anchors.push(anchor)
  } else {
    const index = locate(next, input.ref)
    next.payload.comments[index] = input.comment
    next.anchors[index] = anchor
  }
  return next
}

export function removeComment(draft: ReviewDraft, ref: ReviewCommentRef): ReviewDraft {
  const next = textsEditable(draft)
  const index = locate(next, ref)
  next.payload.comments.splice(index, 1)
  next.anchors.splice(index, 1)
  return next
}

/** The Agent review of the draft (ticket 08): its Session and whether it writes, is done or was stopped. */
export function setAgent(draft: ReviewDraft, agent: { sessionId: string; state: AgentReviewState }): ReviewDraft {
  const next = editable(draft)
  next.agent = { ...next.agent, ...agent }
  return next
}

/** Marks `path` Viewed at `blob`, or not Viewed with null. */
export function setViewed(draft: ReviewDraft, path: string, blob: string | null): ReviewDraft {
  const next = editable(draft)
  if (blob === null) delete next.viewed[path]
  else next.viewed[path] = blob
  return next
}

/** The body of GitHub's POST .../pulls/{n}/reviews, the `payload` review-draft-lint checks: no field of worfy. */
export function reviewPayloadOf(draft: ReviewDraft): { event?: ReviewEvent; body: string; comments: ReviewComment[] } {
  const comments = draft.payload.comments.map(({ path, start_line, start_side, line, side, body }) => ({
    path,
    ...(start_line === undefined ? {} : { start_line }),
    ...(start_side === undefined ? {} : { start_side }),
    line,
    side,
    body,
  }))
  return { ...(draft.payload.event === undefined ? {} : { event: draft.payload.event }), body: draft.payload.body, comments }
}

const sameLine = (a: string, b: string): boolean => a.trimEnd() === b.trimEnd()

/** The first line (1-based) of each place where `lines` stand one after another in `file`. */
function placesOf(file: readonly string[], lines: readonly string[]): number[] {
  const places: number[] = []
  for (let start = 0; start + lines.length <= file.length; start++) {
    if (lines.every((line, offset) => sameLine(file[start + offset] ?? '', line))) places.push(start + 1)
  }
  return places
}

/**
 * Places the comments on the lines of `head`: each comment on the new side is found by the text of its lines
 * (`anchors[i].text`, line ends and trailing spaces aside), at the place nearest to its old one; a range moves whole.
 * A text not found — the file gone or the lines changed — leaves the comment on its old line, marked `moved`. A comment
 * on the old side (LEFT) stays: the base is not the head. `read` gives the text of a file at `head`, null without one.
 */
export function reanchor(draft: ReviewDraft, head: string, read: (path: string) => string | null): ReviewDraft {
  const next = structuredClone(draft)
  const texts = new Map<string, string[] | null>()
  next.payload.comments.forEach((comment, index) => {
    const anchor = next.anchors[index]
    if (anchor === undefined || comment.side !== 'RIGHT' || (comment.start_side ?? 'RIGHT') !== 'RIGHT') return
    if (!texts.has(comment.path)) texts.set(comment.path, read(comment.path)?.split(/\r?\n/u) ?? null)
    const file = texts.get(comment.path) ?? null
    // The range keeps its size: a text written by another writer (bin/pr-review-draft) may have more or fewer lines.
    const size = sizeOf(comment)
    const lines = linesOf(anchor.text, size)
    const old = comment.start_line ?? comment.line
    // A line end at the very end of the file starts no line of its own.
    const length = file === null ? 0 : file.at(-1) === '' ? file.length - 1 : file.length
    // A place where the whole range would not fit — past the end of the file — is no place.
    const places = file === null || anchor.text.trim() === '' ? [] : placesOf(file, lines).filter((place) => place + size - 1 <= length)
    if (places.length === 0) {
      next.anchors[index] = { ...anchor, moved: true }
      return
    }
    const start = places.reduce((best, place) => (Math.abs(place - old) < Math.abs(best - old) ? place : best))
    if (comment.start_line !== undefined) comment.start_line = start
    comment.line = start + size - 1
    next.anchors[index] = { text: anchor.text, by: anchor.by }
  })
  next.anchoredOn = head
  return next
}

// ── Viewed on github.com (ticket 09) ───────────────────────────────────────

/** Runs `gh <args>` as the Project's account and resolves its stdout; rejects with gh's reason. */
export type GhCall = (args: readonly string[]) => Promise<string>

/** The files of a PR page by page, with whether the account marked each Viewed. A query, never a mutation. */
export const VIEWED_QUERY =
  'query($owner: String!, $name: String!, $pr: Int!, $after: String) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) { files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } } } } }'

/** GitHub lists at most 3,000 files of a PR: 30 pages of 100. */
const VIEWED_PAGES_MAX = 30

const viewedPageSchema = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequest: z
          .object({
            files: z.object({
              pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() }),
              nodes: z.array(z.object({ path: z.string(), viewerViewedState: z.string().nullish() }).nullable()),
            }),
          })
          .nullable(),
      })
      .nullable(),
  }),
})

/** The paths of the PR's files the account marked Viewed on github.com (`VIEWED`; a `DISMISSED` mark is one the file's change since took away). */
export async function viewedOnGithub(call: GhCall, repo: string, pr: number): Promise<string[]> {
  const [owner = '', name = ''] = repo.split('/')
  const viewed: string[] = []
  let after: string | null = null
  for (let page = 0; page < VIEWED_PAGES_MAX; page++) {
    const args = ['api', 'graphql', '-f', `query=${VIEWED_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${pr}`, ...(after === null ? [] : ['-f', `after=${after}`])]
    const answer = viewedPageSchema.parse(JSON.parse(await call(args)))
    const files = answer.data.repository?.pullRequest?.files
    if (files === undefined) throw new Error(`GitHub does not show ${repo}#${pr} to the account`)
    for (const node of files.nodes) if (node?.viewerViewedState === 'VIEWED') viewed.push(node.path)
    if (!files.pageInfo.hasNextPage || files.pageInfo.endCursor == null) break
    after = files.pageInfo.endCursor
  }
  return viewed
}

/** The draft Start review creates: on `head`, the files GitHub says are Viewed marked at the blob Review mode lists them with. */
export function startedDraft(repo: string, pr: number, head: string, files: readonly { path: string; blob: string }[], viewed: readonly string[]): ReviewDraft {
  const draft = newReviewDraft(repo, pr, head)
  const marked = new Set(viewed)
  for (const file of files) if (marked.has(file.path)) draft.viewed[file.path] = file.blob
  return draft
}

// ── the file ───────────────────────────────────────────────────────────────

/** A change waiting for the next write: applied to the draft in the file then (null — no draft). */
type Change = (draft: ReviewDraft | null) => ReviewDraft

interface Pending {
  changes: Change[]
  timer: ReturnType<typeof setTimeout> | null
  repo: string
  pr: number
}

export interface PrReviewDraftsOptions {
  /** The Project's Profile folder (readProfileFolder): null, with the reason, when it has none. */
  profileDir: (root: string) => Promise<{ dir: string | null; reason: string | null }>
  now?: () => number
  /** For tests: the write of the temporary file. */
  writeFile?: (file: string, text: string) => Promise<void>
  /** For tests: the removal of the temporary file after a write. */
  removeTemp?: (file: string) => Promise<void>
  /** For tests: after each rename of a draft file into place. */
  wrote?: (file: string) => void
  warn?: (message: string) => void
}

/** The draft in `text`, of whatever PR; a refusal when it is not JSON or not of the draft's shape. */
function parseAny(text: string, file: string): ReviewDraft {
  let json: unknown
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (error) {
    throw new ReviewDraftRefusal(`The review draft ${file} is not JSON: ${messageOf(error)}`)
  }
  const parsed = reviewDraftSchema.safeParse(json)
  if (!parsed.success) throw new ReviewDraftRefusal(`The review draft ${file} has another shape: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  return parsed.data
}

/** The draft of `repo`#`pr` in `text`: a draft of another PR is refused too. */
function ownDraft(draft: ReviewDraft, file: string, repo: string, pr: number): ReviewDraft {
  if (draft.repo !== repo || draft.pr !== pr) throw new ReviewDraftRefusal(`The review draft ${file} is of ${draft.repo}#${draft.pr}`)
  return draft
}

const parse = (text: string, file: string, repo: string, pr: number): ReviewDraft => ownDraft(parseAny(text, file), file, repo, pr)

/** The draft of `text` (null — no file) with `changes` applied; a change that no longer applies is dropped and told. */
function applied(text: string | null, changes: readonly Change[], file: string, repo: string, pr: number, warn: (message: string) => void): ReviewDraft | null {
  let draft = text === null ? null : parse(text, file, repo, pr)
  for (const change of changes) {
    try {
      draft = change(draft)
    } catch (error) {
      warn(`[pr-review] a change of ${file} was dropped: ${messageOf(error)}`)
    }
  }
  return draft
}

const serialize = (draft: ReviewDraft): string => `${JSON.stringify(draft, null, 2)}\n`

/** What a refused lock, or a rename Windows refuses for a moment, fails with: try again. */
const BUSY = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY'])
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code
const lockOf = (file: string): string => `${file}.lock`
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const pauseSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** One try at the lock of `file`: true when taken; a stale lock is removed for the next try. */
function tryLock(file: string, now: number): boolean {
  try {
    writeFileSync(lockOf(file), `${process.pid}\n`, { flag: 'wx' })
    return true
  } catch (error) {
    if (!BUSY.has(codeOf(error) ?? '')) throw error
  }
  try {
    // shortcut: two writers that find one stale lock at once may both take it over, redo with a lock that names its
    // owner if a writer is ever seen to die while holding it.
    if (now - statSync(lockOf(file)).mtimeMs > LOCK_STALE_MS) removeFile(lockOf(file))
  } catch {
    // Released meanwhile: the next try takes it.
  }
  return false
}

/** Whether the lock of `file` is there and names this process: a writer that found it stale may have taken it over. */
function ownLock(file: string): boolean {
  try {
    return readFileSync(lockOf(file), 'utf8').trim() === String(process.pid)
  } catch {
    return false
  }
}

/** Removes the lock of `file` only while it is this process's: never one another writer took over meanwhile. */
const unlock = (file: string): void => {
  if (ownLock(file)) removeFile(lockOf(file))
}
const lockedFor = (file: string): ReviewDraftRefusal => new ReviewDraftRefusal(`The review draft ${file} stayed locked by another writer (an Agent review) for ${LOCK_WAIT_MS / 1000} s`)

/**
 * The draft files whose lock a write of this process took. A quit (flushSync) finds one when it comes while that write
 * waits for its disk: while the lock still names this process it writes at once, not after the lock goes stale, since
 * nothing of this process runs again before the quit ends, and the lock keeps the script out meanwhile. A lock the
 * script took over as stale is waited for like any other.
 */
const heldHere = new Set<string>()

/** Runs `work` holding the lock of `file`, which its folder must hold already. */
async function withLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const until = Date.now() + LOCK_WAIT_MS
  while (!tryLock(file, Date.now())) {
    if (Date.now() > until) throw lockedFor(file)
    await pause(2 + Math.floor(Math.random() * 8))
  }
  heldHere.add(file)
  try {
    return await work()
  } finally {
    heldHere.delete(file)
    unlock(file)
  }
}

function withLockSync<T>(file: string, work: () => T): T {
  if (heldHere.has(file) && ownLock(file)) {
    try {
      return work()
    } finally {
      heldHere.delete(file)
      unlock(file)
    }
  }
  const until = Date.now() + LOCK_WAIT_MS
  while (!tryLock(file, Date.now())) {
    if (Date.now() > until) throw lockedFor(file)
    pauseSync(5)
  }
  try {
    return work()
  } finally {
    unlock(file)
  }
}

/** A rename into place; Windows refuses one for a moment while another process opens the target. */
async function renameInto(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (!BUSY.has(codeOf(error) ?? '') || attempt >= 50) throw error
      await pause(10)
    }
  }
}

export class PrReviewDrafts {
  private readonly pending = new Map<string, Pending>()
  private readonly lastWrite = new Map<string, number>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly folders = new Map<string, { dir: string; at: number }>()
  /** The Profile folders whose old submitted drafts were removed in this run of worfy. */
  private readonly pruned = new Set<string>()
  /** The Start reviews under way, by draft file: a second one of the same PR waits for the first and reads nothing. */
  private readonly starts = new Map<string, Promise<PrReviewDraftAnswer>>()
  private readonly now: () => number
  private readonly warn: (message: string) => void

  constructor(private readonly options: PrReviewDraftsOptions) {
    this.now = options.now ?? Date.now
    this.warn = options.warn ?? ((message) => console.warn(message))
  }

  /** The draft of `repo`#`pr`: null without one, a problem without a Profile folder or with a broken file. */
  async draft(root: string, repo: string, pr: number): Promise<PrReviewDraftAnswer> {
    try {
      const file = await this.file(root, repo, pr)
      return await this.exclusive(file, async () => this.answer(file, repo, pr))
    } catch (error) {
      return { repo, pr, draft: null, problem: messageOf(error) }
    }
  }

  /** A comment of the person, new or changed; a draft created now starts on `head`. */
  saveComment(root: string, repo: string, pr: number, input: { head: string; ref?: ReviewCommentRef | undefined; comment: ReviewComment; anchor: string }): Promise<PrReviewDraftAnswer> {
    return this.change(root, repo, pr, (draft) => putComment(draft ?? newReviewDraft(repo, pr, input.head), input))
  }

  deleteComment(root: string, repo: string, pr: number, ref: ReviewCommentRef): Promise<PrReviewDraftAnswer> {
    return this.change(root, repo, pr, (draft) => {
      if (draft === null) throw new ReviewDraftRefusal(`There is no review draft of ${repo}#${pr}`)
      return removeComment(draft, ref)
    })
  }

  setViewed(root: string, repo: string, pr: number, head: string, path: string, blob: string | null): Promise<PrReviewDraftAnswer> {
    return this.change(root, repo, pr, (draft) => setViewed(draft ?? newReviewDraft(repo, pr, head), path, blob))
  }

  /**
   * The Agent review of the draft (ticket 08): `writing` when it starts — a draft created now starts on `head` — and
   * `stopped` on Stop or Take over. Written at once, not after WRITE_INTERVAL_MS: the Session's bin/pr-review-draft
   * reads the file, and refuses without a draft or after a stop.
   */
  setAgent(root: string, repo: string, pr: number, input: { head?: string; agent: { sessionId: string; state: AgentReviewState } }): Promise<PrReviewDraftAnswer> {
    return this.change(
      root,
      repo,
      pr,
      (draft) => {
        if (draft === null && input.head === undefined) throw new ReviewDraftRefusal(`There is no review draft of ${repo}#${pr}`)
        return setAgent(draft ?? newReviewDraft(repo, pr, input.head ?? ''), input.agent)
      },
      { now: true },
    )
  }

  /**
   * Start review (ticket 09): the draft of the PR as it is; without one, a new one on `head` with the files the account
   * marked Viewed on github.com (`viewed`, called once here; null — no reader). A read that fails starts the draft
   * without marks, and is not tried again: the draft is there.
   */
  async start(root: string, repo: string, pr: number, input: { head: string; files: readonly { path: string; blob: string }[]; viewed: (() => Promise<string[]>) | null }): Promise<PrReviewDraftAnswer> {
    const file = await this.file(root, repo, pr)
    const running = this.starts.get(file)
    if (running !== undefined) return running.then(() => this.draft(root, repo, pr))
    const started = (async (): Promise<PrReviewDraftAnswer> => {
      const current = await this.draft(root, repo, pr)
      if (current.draft !== null || current.problem !== null) return current
      let viewed: string[] = []
      try {
        viewed = input.viewed === null ? [] : await input.viewed()
      } catch (error) {
        this.warn(`[pr-review] the files Viewed on github.com of ${repo}#${pr} were not read: ${messageOf(error)}`)
      }
      return this.change(root, repo, pr, (draft) => draft ?? startedDraft(repo, pr, input.head, input.files, viewed), { now: true })
    })()
    this.starts.set(file, started)
    try {
      return await started
    } finally {
      this.starts.delete(file)
    }
  }

  /**
   * Discard review: the file goes, and the changes waiting for it. A review being submitted (its mark younger than
   * LISTING_WAIT_MS) is not discarded, nor a
   * draft of another PR. A file that is no draft at all (half written, another shape) goes too: nothing else can change
   * or remove it, so without this the PR would keep it for good.
   */
  async discard(root: string, repo: string, pr: number): Promise<PrReviewDraftAnswer> {
    const file = await this.file(root, repo, pr)
    return this.exclusive(file, async () => {
      if ((await this.read(file)) === null) {
        this.drop(file)
        return { repo, pr, draft: null, problem: null }
      }
      // Under the lock: an Agent review that read the draft before cannot write it back after.
      return withLock(file, async () => {
        const text = await this.read(file)
        let draft: ReviewDraft | null = null
        try {
          draft = text === null ? null : parseAny(text, file)
        } catch {
          // Not a draft: removed below.
        }
        // A POST may still run while its mark is young; a Submit GitHub did not confirm is over, and may be discarded
        // with the warning of the bar: the lookup can fail for good (access lost, repository gone).
        if (draft !== null && ownDraft(draft, file, repo, pr).state === 'submitting' && markAge(draft) < LISTING_WAIT_MS)
          throw new ReviewDraftRefusal('This review is being submitted: it is not discarded')
        this.drop(file)
        await rm(file, { force: true })
        return { repo, pr, draft: null, problem: null }
      })
    })
  }

  /** The PRs with a draft in the Project's Profile folder; the submitted drafts older than SUBMITTED_KEEP_MS go first, once a run. */
  async list(root: string): Promise<{ drafts: PrReviewDraftRow[]; problem: string | null }> {
    const folder = await this.folder(root)
    if (folder.dir === null) return { drafts: [], problem: `The Project has no Profile folder, where review drafts live: ${folder.reason ?? 'unknown'}` }
    if (!this.pruned.has(folder.dir)) {
      this.pruned.add(folder.dir)
      await this.prune(folder.dir)
    }
    const drafts: PrReviewDraftRow[] = []
    for (const name of await this.names(folder.dir)) {
      const file = join(folder.dir, 'state', 'pr-review', name)
      try {
        const json = JSON.parse(await readFile(file, 'utf8')) as { repo?: unknown; pr?: unknown }
        if (typeof json.repo !== 'string' || typeof json.pr !== 'number') continue
        const { draft } = await this.draft(root, json.repo, json.pr)
        if (draft !== null) drafts.push({ repo: draft.repo, pr: draft.pr, comments: draft.payload.comments.length, startedOn: draft.startedOn, state: draft.state })
      } catch {
        // A file being renamed away, or not a draft: not a row.
      }
    }
    return { drafts, problem: null }
  }

  /** Removes the submitted drafts of `profileDir` older than SUBMITTED_KEEP_MS (from `submittedAt`, else the file's time). */
  async prune(profileDir: string): Promise<void> {
    for (const name of await this.names(profileDir)) {
      const file = join(profileDir, 'state', 'pr-review', name)
      try {
        const json = JSON.parse(await readFile(file, 'utf8')) as { state?: unknown; submittedAt?: unknown }
        if (json.state !== 'submitted') continue
        const at = typeof json.submittedAt === 'string' && !Number.isNaN(Date.parse(json.submittedAt)) ? Date.parse(json.submittedAt) : (await stat(file)).mtimeMs
        if (this.now() - at > SUBMITTED_KEEP_MS) await rm(file, { force: true })
      } catch (error) {
        this.warn(`[pr-review] ${file} was not looked at for removal: ${messageOf(error)}`)
      }
    }
  }

  /**
   * A change of Submit review (pr-review-submit.ts, ticket 11): its marks `submitting` and `submitted`, written at once
   * with what waits, under the lock. `change` gets the draft as the file has it and may refuse; a change that no
   * longer applies to the file when it is written is dropped, so Submit reads the file again after it.
   */
  changeNow(root: string, repo: string, pr: number, change: (draft: ReviewDraft | null) => ReviewDraft): Promise<PrReviewDraftAnswer> {
    return this.change(root, repo, pr, change, { now: true })
  }

  /** Writes every change waiting now. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((file) => this.exclusive(file, async () => this.write(file))))
  }

  /** The same, synchronously, for `will-quit`: no promise of main runs after it. */
  flushSync(): void {
    for (const [file, pending] of [...this.pending]) {
      this.drop(file)
      try {
        mkdirSync(dirname(file), { recursive: true })
        withLockSync(file, () => {
          let text: string | null = null
          try {
            text = readFileSync(file, 'utf8')
          } catch {
            // No file yet.
          }
          const draft = applied(text, pending.changes, file, pending.repo, pending.pr, this.warn)
          if (draft === null) return
          const tmp = `${file}.${randomUUID()}.tmp`
          writeFileSync(tmp, serialize(draft))
          renameSync(tmp, file)
        })
      } catch (error) {
        this.warn(`[pr-review] ${file} was not written at quit: ${messageOf(error)}`)
      }
    }
  }

  // ── inside ──────────────────────────────────────────────────────────────

  private async change(root: string, repo: string, pr: number, change: Change, options: { now?: boolean } = {}): Promise<PrReviewDraftAnswer> {
    const file = await this.file(root, repo, pr)
    return this.exclusive(file, async () => {
      // Refused now, with the reason, when it does not apply to what the view sees.
      const draft = change((await this.answer(file, repo, pr)).draft)
      const pending = this.pending.get(file) ?? { changes: [], timer: null, repo, pr }
      pending.changes.push(change)
      this.pending.set(file, pending)
      const wait = (this.lastWrite.get(file) ?? -Infinity) + WRITE_INTERVAL_MS - this.now()
      if (wait <= 0 || options.now === true) {
        try {
          await this.write(file, options.now === true)
        } catch (error) {
          // The change is taken and waits: the view shows it, told it is not on disk yet, so it is not saved twice.
          return { repo, pr, draft, problem: `The review draft is not written yet: ${messageOf(error)}. worfy writes it with the next change, and when it quits` }
        }
      } else if (pending.timer === null) {
        pending.timer = setTimeout(() => void this.exclusive(file, async () => this.write(file)).catch((error: unknown) => this.warn(`[pr-review] ${file} was not written: ${messageOf(error)}`)), wait)
        pending.timer.unref?.()
      }
      return { repo, pr, draft, problem: null }
    })
  }

  /** The file with the waiting changes applied. */
  private async answer(file: string, repo: string, pr: number): Promise<PrReviewDraftAnswer> {
    const draft = applied(await this.read(file), this.pending.get(file)?.changes ?? [], file, repo, pr, () => undefined)
    return { repo, pr, draft, problem: null }
  }

  /**
   * Writes the waiting changes of `file`, applied to the file as it is now, through a temporary file and a rename. They
   * stop waiting only once written: a write that fails — the file unreadable or broken meanwhile, the disk — keeps them
   * waiting for the next one, and the file stays as it was.
   */
  private async write(file: string, now = false): Promise<void> {
    const pending = this.pending.get(file)
    if (pending === undefined) return
    if (pending.timer !== null) clearTimeout(pending.timer)
    pending.timer = null
    const wait = (this.lastWrite.get(file) ?? -Infinity) + WRITE_INTERVAL_MS - this.now()
    if (wait > 0 && !now) {
      // A timer that fired a little early: wait the rest.
      pending.timer = setTimeout(() => void this.exclusive(file, async () => this.write(file)).catch(() => undefined), wait)
      pending.timer.unref?.()
      return
    }
    const tmp = `${file}.${randomUUID()}.tmp`
    let written = false
    try {
      await mkdir(dirname(file), { recursive: true })
      await withLock(file, async () => {
        const draft = applied(await this.read(file), pending.changes, file, pending.repo, pending.pr, this.warn)
        if (draft !== null) {
          await (this.options.writeFile ?? ((path, text) => writeFile(path, text)))(tmp, serialize(draft))
          await renameInto(tmp, file)
          written = true
        }
        // Right after the rename, with no await between: a quit (flushSync) while the temporary file is removed must not
        // find the written changes still waiting. Inside exclusive(): no change came meanwhile, so what waited is what was written.
        this.drop(file)
      })
    } finally {
      await (this.options.removeTemp ?? ((path) => rm(path, { force: true })))(tmp)
    }
    if (!written) return
    this.lastWrite.set(file, this.now())
    this.options.wrote?.(file)
  }

  /** Forgets the changes waiting for `file`, and their timer. */
  private drop(file: string): void {
    const pending = this.pending.get(file)
    if (pending?.timer != null) clearTimeout(pending.timer)
    this.pending.delete(file)
  }

  private async file(root: string, repo: string, pr: number): Promise<string> {
    const folder = await this.folder(root)
    if (folder.dir === null) throw new ReviewDraftRefusal(`The Project has no Profile folder, where review drafts live: ${folder.reason ?? 'unknown'}`)
    return reviewDraftFilePath(folder.dir, repo, pr)
  }

  private async folder(root: string): Promise<{ dir: string | null; reason: string | null }> {
    const kept = this.folders.get(root)
    if (kept !== undefined && this.now() - kept.at < FOLDER_TTL_MS) return { dir: kept.dir, reason: null }
    const folder = await this.options.profileDir(root)
    if (folder.dir === null) this.folders.delete(root)
    else this.folders.set(root, { dir: folder.dir, at: this.now() })
    return folder
  }

  private async names(profileDir: string): Promise<string[]> {
    try {
      return (await readdir(join(profileDir, 'state', 'pr-review'))).filter((name) => FILE.test(name)).sort()
    } catch {
      return []
    }
  }

  private async read(file: string): Promise<string | null> {
    try {
      return await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new ReviewDraftRefusal(`The review draft ${file} cannot be read: ${messageOf(error)}`)
    }
  }

  /** Runs `work` after every change of `file` queued before it. */
  private exclusive<T>(file: string, work: () => Promise<T>): Promise<T> {
    const before = this.queues.get(file) ?? Promise.resolve()
    const next = before.then(work, work)
    const settled = next.catch(() => undefined)
    this.queues.set(file, settled)
    void settled.then(() => {
      if (this.queues.get(file) === settled) this.queues.delete(file)
    })
    return next
  }
}

