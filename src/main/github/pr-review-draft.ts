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
// - Discard removes the file. A submitted draft is kept SUBMITTED_KEEP_MS (the link to the review) and removed at the
//   first look at the Project's drafts after worfy starts.
// - Nothing here reaches GitHub.
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  reviewDraftSchema,
  type PrReviewDraftAnswer,
  type PrReviewDraftRow,
  type ReviewComment,
  type ReviewCommentRef,
  type ReviewDraft,
  type ReviewEvent,
} from '../../shared/ipc/pr-review'

/** At most one write of a draft file in this many milliseconds. */
export const WRITE_INTERVAL_MS = 500
/** How long a submitted draft is kept. */
export const SUBMITTED_KEEP_MS = 30 * 24 * 60 * 60 * 1000
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
  const next = editable(draft)
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
  const next = editable(draft)
  const index = locate(next, ref)
  next.payload.comments.splice(index, 1)
  next.anchors.splice(index, 1)
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
    const places = file === null || anchor.text.trim() === '' ? [] : placesOf(file, lines)
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

export class PrReviewDrafts {
  private readonly pending = new Map<string, Pending>()
  private readonly lastWrite = new Map<string, number>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly folders = new Map<string, { dir: string; at: number }>()
  /** The Profile folders whose old submitted drafts were removed in this run of worfy. */
  private readonly pruned = new Set<string>()
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
   * Discard review: the file goes, and the changes waiting for it. A review being submitted is not discarded, nor a
   * draft of another PR. A file that is no draft at all (half written, another shape) goes too: nothing else can change
   * or remove it, so without this the PR would keep it for good.
   */
  async discard(root: string, repo: string, pr: number): Promise<PrReviewDraftAnswer> {
    const file = await this.file(root, repo, pr)
    return this.exclusive(file, async () => {
      const text = await this.read(file)
      let draft: ReviewDraft | null = null
      try {
        draft = text === null ? null : parseAny(text, file)
      } catch {
        // Not a draft: removed below.
      }
      if (draft !== null && ownDraft(draft, file, repo, pr).state === 'submitting') throw new ReviewDraftRefusal('This review is being submitted: it is not discarded')
      this.drop(file)
      await rm(file, { force: true })
      return { repo, pr, draft: null, problem: null }
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

  /** Writes every change waiting now. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((file) => this.exclusive(file, async () => this.write(file))))
  }

  /** The same, synchronously, for `will-quit`: no promise of main runs after it. */
  flushSync(): void {
    for (const [file, pending] of [...this.pending]) {
      this.drop(file)
      let text: string | null = null
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        // No file yet.
      }
      try {
        const draft = applied(text, pending.changes, file, pending.repo, pending.pr, this.warn)
        if (draft === null) continue
        const tmp = `${file}.${randomUUID()}.tmp`
        writeFileSync(tmp, serialize(draft))
        renameSync(tmp, file)
      } catch (error) {
        this.warn(`[pr-review] ${file} was not written at quit: ${messageOf(error)}`)
      }
    }
  }

  // ── inside ──────────────────────────────────────────────────────────────

  private async change(root: string, repo: string, pr: number, change: Change): Promise<PrReviewDraftAnswer> {
    const file = await this.file(root, repo, pr)
    return this.exclusive(file, async () => {
      // Refused now, with the reason, when it does not apply to what the view sees.
      const draft = change((await this.answer(file, repo, pr)).draft)
      const pending = this.pending.get(file) ?? { changes: [], timer: null, repo, pr }
      pending.changes.push(change)
      this.pending.set(file, pending)
      const wait = (this.lastWrite.get(file) ?? -Infinity) + WRITE_INTERVAL_MS - this.now()
      if (wait <= 0) {
        try {
          await this.write(file)
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
  private async write(file: string): Promise<void> {
    const pending = this.pending.get(file)
    if (pending === undefined) return
    if (pending.timer !== null) clearTimeout(pending.timer)
    pending.timer = null
    const wait = (this.lastWrite.get(file) ?? -Infinity) + WRITE_INTERVAL_MS - this.now()
    if (wait > 0) {
      // A timer that fired a little early: wait the rest.
      pending.timer = setTimeout(() => void this.exclusive(file, async () => this.write(file)).catch(() => undefined), wait)
      pending.timer.unref?.()
      return
    }
    const tmp = `${file}.${randomUUID()}.tmp`
    let written = false
    try {
      const draft = applied(await this.read(file), pending.changes, file, pending.repo, pending.pr, this.warn)
      if (draft !== null) {
        await mkdir(dirname(file), { recursive: true })
        await (this.options.writeFile ?? ((path, text) => writeFile(path, text)))(tmp, serialize(draft))
        await rename(tmp, file)
        written = true
      }
    } finally {
      await rm(tmp, { force: true })
    }
    // Inside exclusive(): no change came meanwhile, so what waited is what was written.
    this.drop(file)
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

