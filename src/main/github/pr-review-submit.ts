// Submit review (worfy-pr-review ticket 11, ADR-0112): the review of someone else's PR goes to GitHub as one POST, only
// on the person's click in the Finish review dialog, with exactly the texts the dialog shows. The third write of main to
// GitHub, beside the two of pr-reply-send.ts (ADR-0105, point 4), and built the same way: look, check, mark, one POST.
//
// Submit, in this order, one at a time per draft file:
// 1. The draft as the file has it (pr-review-draft.ts). Nothing while the Session of an Agent review writes it, nor
//    for a review submitted already. The texts shown must be the file's: the verdict and the summary the person chose
//    (the summary may be new — it goes into the file with the mark), and each comment shown one of the file's, as it
//    is; a comment the person removed in the dialog, or one the dialog did not show, is not posted. The commit the
//    dialog says the comments go on must be the draft's (`anchoredOn`, else `startedOn`): the lines of each comment
//    are numbered on it, so the review goes on it — never on a later head, where the numbers name other lines.
// 2. review-draft-lint over those texts (the body of the POST): the traces of the workflow, an AI signature, personal
//    data, the length — the Team reviewer's lint.json when the Project has one, else the template's lengths. A finding,
//    or a lint that could not run, and nothing is posted.
// 3. The account the Project's Profile names (`github.account`); none named — nothing is posted.
// 4. GitHub as it is now, by reads only: the PR (its head; the author — Approve and Request changes on the account's own
//    PR are refused), a head that moved since the dialog opened is refused with the head now, so the dialog says so
//    before the person submits on the old commit; then the files of the diff on that commit — every comment on a line
//    of a hunk, a range within one hunk (GitHub refuses the review whole otherwise, 422).
// 5. A Submit whose earlier one GitHub did not confirm — the mark `submitting` left by a crash, or the words of
//    UNCONFIRMED — first reads the reviews of the PR and looks for this account's on the same commit, with the same
//    body and verdict: found, the draft is only marked submitted.
// 6. The mark `submitting` in the file with the texts that go, then the file read again, then one
//    `POST repos/{o}/{r}/pulls/{n}/reviews` as that account, its body `{ commit_id, event, body, comments }` from the
//    file, without a byte added. GitHub's answer marks the draft `submitted` with the review's link. A refusal of
//    GitHub (4xx) takes the draft back to `draft` with GitHub's reason: nothing was created. Any other failure — 5xx,
//    the network, gh's time limit — takes it back with UNCONFIRMED in the reason, and the next Submit looks first.
//    Never retried by itself.
// - Never: a request without `event` (a pending review on GitHub), a second POST on one click, resolve, re-request
//   review, dismiss, merge.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { ChangesPrRef, DiffHunk } from '../../shared/changes/types'
import type { PrReviewSubmitAnswer, ReviewComment, ReviewDraft, ReviewEvent } from '../../shared/ipc/pr-review'
import { PrDiffs, patchHunks, type GhReader } from '../changes/github'
import { NO_GITHUB_HEALTH, type GithubHealth } from './github-health'
import { lintRulesPath, type LintRun } from './pr-reply-send'
import { reviewPayloadOf, type PrReviewDrafts } from './pr-review-draft'
import { accountAuth, GhExitError, type GhEnv, type GhRunner } from './prs'

export type { LintRun }

/** The words every reason of a Submit GitHub did not confirm carries: the next Submit looks on GitHub first. */
export const UNCONFIRMED = 'GitHub did not confirm the review'
export const NO_ACCOUNT =
  "Not submitted: the Project's Profile names no GitHub account (github.account). Set it to the account reviews go from; worfy never posts as the gh login of the machine"
export const AGENT_WRITING = 'Not submitted: the agent is still writing the review. Wait until it finishes, or stop it'
export const OWN_PULL = 'GitHub does not let you approve or request changes on your own pull request'
/** GitHub needs a body for these verdicts: a summary or a comment. */
export const NEEDS_TEXT = 'GitHub needs a summary or a comment for this verdict'
/** How many pages of the PR's reviews a Submit GitHub did not confirm reads to find it. */
const REVIEW_PAGES_MAX = 30

const STATES: Readonly<Record<ReviewEvent, readonly string[]>> = { APPROVE: ['APPROVED', 'DISMISSED'], REQUEST_CHANGES: ['CHANGES_REQUESTED', 'DISMISSED'], COMMENT: ['COMMENTED'] }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const firstLine = (text: string): string => text.trim().split('\n')[0]?.trim() ?? ''
const unconfirmed = (error: string | undefined): boolean => error !== undefined && error.includes(UNCONFIRMED)
const sameSha = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
/** GitHub keeps a body as sent, but line ends may come back as LF and trailing white space may go. */
const sameText = (a: string, b: string): boolean => a.replace(/\r\n/gu, '\n').trimEnd() === b.replace(/\r\n/gu, '\n').trimEnd()
const sameComment = (a: ReviewComment, b: ReviewComment): boolean =>
  a.path === b.path && a.line === b.line && a.side === b.side && a.start_line === b.start_line && a.start_side === b.start_side && a.body === b.body
/** The commit the comments of a draft are numbered on, which the review goes on. */
export const draftCommitOf = (draft: Pick<ReviewDraft, 'anchoredOn' | 'startedOn'>): string => draft.anchoredOn ?? draft.startedOn
const whereOf = (comment: ReviewComment): string => `${comment.path}:${comment.start_line === undefined ? comment.line : `${comment.start_line}–${comment.line}`}`

/** The texts the dialog shows and Submit sends. */
export interface SubmittedTexts {
  event: ReviewEvent
  body: string
  comments: readonly ReviewComment[]
}

export interface PrReviewSubmitterOptions {
  /** gh, as the PR inbox runs it; WORFY_GH points it at a stand-in in tests. */
  run: GhRunner
  /** The GitHub account the Project's Profile names (`github.account`); null when it names none, and then nothing is posted. */
  account: (root: string) => Promise<string | null>
  drafts: Pick<PrReviewDrafts, 'draft' | 'changeNow'>
  /** The Project's Profile folder: the Team reviewer's lint.json lies there. */
  profileDir: (root: string) => Promise<{ dir: string | null; reason: string | null }>
  /** `review-draft-lint - -C <root> [--rules <rules>]` with `draft` on its stdin. */
  lint: (draft: string, root: string, rules: string | null) => Promise<LintRun>
  /** What a Submit tells Health check, as Send does. Nothing by default. */
  health?: GithubHealth
}

/** A refusal before any POST, with the reason the dialog shows. */
class Refusal extends Error {
  constructor(
    message: string,
    readonly head: string | null = null,
  ) {
    super(message)
  }
}

export class PrReviewSubmitter {
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly diffs = new PrDiffs()
  private readonly health: GithubHealth

  constructor(private readonly options: PrReviewSubmitterOptions) {
    this.health = options.health ?? NO_GITHUB_HEALTH
  }

  /** The check of the dialog: review-draft-lint over the texts shown. Never reaches GitHub. */
  async check(root: string, repo: string, pr: number, texts: SubmittedTexts): Promise<{ findings: string[]; reason: string | null }> {
    const lint = await this.lint(root, texts)
    return lint.kind === 'findings' ? { findings: lint.findings, reason: null } : lint.kind === 'clean' ? { findings: [], reason: null } : { findings: [], reason: lint.reason }
  }

  /** Submit, on the person's click: see the head of the file. One at a time per PR. */
  submit(root: string, repo: string, pr: number, input: SubmittedTexts & { commit: string; head: string }): Promise<PrReviewSubmitAnswer> {
    const key = `${root}\n${repo.toLowerCase()}#${pr}`
    const before = this.queues.get(key) ?? Promise.resolve()
    const next = before.then(
      () => this.submitNow(root, repo, pr, input),
      () => this.submitNow(root, repo, pr, input),
    )
    const settled = next.catch(() => undefined)
    this.queues.set(key, settled)
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key)
    })
    return next
  }

  private async submitNow(root: string, repo: string, pr: number, input: SubmittedTexts & { commit: string; head: string }): Promise<PrReviewSubmitAnswer> {
    const answer = async (outcome: PrReviewSubmitAnswer['outcome'], reason: string | null, extra: { reviewUrl?: string | null; head?: string | null } = {}): Promise<PrReviewSubmitAnswer> => ({
      outcome,
      reason,
      reviewUrl: extra.reviewUrl ?? null,
      head: extra.head ?? null,
      draft: (await this.options.drafts.draft(root, repo, pr)).draft,
    })
    try {
      // 1. The draft, and the texts shown in it.
      const draft = await this.read(root, repo, pr)
      const texts = textsOf(draft, input)
      // 2. The check over exactly those texts.
      const lint = await this.lint(root, texts)
      if (lint.kind === 'findings') throw new Refusal(`Not submitted: review-draft-lint found ${lint.findings.join('; ')}`)
      if (lint.kind === 'broken') throw new Refusal(lint.reason)
      // 3. As the Project's account, and no other.
      const account = await this.options.account(root)
      if (account === null) {
        this.health.signInFailed(root, NO_ACCOUNT)
        throw new Refusal(NO_ACCOUNT)
      }
      let env: GhEnv
      try {
        env = await accountAuth({ account: () => Promise.resolve(account), run: this.options.run })(root)
      } catch (error) {
        this.health.failed(root, messageOf(error))
        throw new Refusal(`Not submitted: ${messageOf(error)}`)
      }
      const get = async (path: string): Promise<string> => this.options.run(['api', path], root, env)
      // 4. GitHub as it is now: the head, the author, the lines of the diff on the commit.
      const commit = draftCommitOf(draft)
      let pull: PullNow
      try {
        pull = pullSchema.parse(JSON.parse(await get(`repos/${repo}/pulls/${pr}`)))
      } catch (error) {
        this.health.failed(root, messageOf(error))
        throw new Refusal(`Not submitted: worfy could not read ${repo}#${pr} on GitHub: ${firstLine(messageOf(error))}`)
      }
      if (input.event !== 'COMMENT' && pull.user?.login?.toLowerCase() === account.toLowerCase()) throw new Refusal(OWN_PULL)
      if (!sameSha(pull.head.sha, input.head)) throw new Refusal(`Not submitted: the head of ${repo}#${pr} moved to ${pull.head.sha.slice(0, 7)} since the dialog opened. Look at it again`, pull.head.sha)
      const off = await this.offLines(texts.comments, { who: root, get }, { kind: 'pr', repo, number: pr, headOid: commit, baseOid: pull.base.sha }, sameSha(pull.head.sha, commit))
      if (off.length > 0) throw new Refusal(`Not submitted: GitHub refuses a comment off the lines of the diff on ${commit.slice(0, 7)} — ${off.join('; ')}. Move it to a changed line or remove it`)
      // 5. A Submit GitHub did not confirm may have landed: look first.
      if (draft.state === 'submitting' || unconfirmed(draft.error)) {
        let found: { url: string | null } | null
        try {
          found = await this.posted(get, repo, pr, account, commit, texts)
        } catch (error) {
          this.health.failed(root, messageOf(error))
          throw new Refusal(`Not submitted: ${UNCONFIRMED} before, and worfy could not look whether it is on GitHub now: ${firstLine(messageOf(error))}`)
        }
        if (found !== null) {
          const marked = await this.markSubmitted(root, repo, pr, found.url)
          this.health.answered(root)
          return answer('already-submitted', marked, { reviewUrl: found.url })
        }
      }
      // 6. The mark, the file read again, one POST.
      const marking = await this.options.drafts.changeNow(root, repo, pr, (current) => markSubmitting(current, texts, commit))
      const marked = (await this.options.drafts.draft(root, repo, pr)).draft
      if (marking.problem !== null || marked === null || marked.state !== 'submitting')
        throw new Refusal(`Not submitted: the draft could not be marked before the POST${marking.problem === null ? '' : `: ${marking.problem}`}`)
      return await this.post(root, repo, pr, env, marked, answer)
    } catch (error) {
      if (error instanceof Refusal) return answer('refused', error.message, { head: error.head })
      return answer('refused', `Not submitted: ${messageOf(error)}`)
    }
  }

  /** The one POST, from the draft marked `submitting`; its answer marks the draft. */
  private async post(root: string, repo: string, pr: number, env: GhEnv, marked: ReviewDraft, answer: (outcome: PrReviewSubmitAnswer['outcome'], reason: string | null, extra?: { reviewUrl?: string | null }) => Promise<PrReviewSubmitAnswer>): Promise<PrReviewSubmitAnswer> {
    const payload = reviewPayloadOf(marked)
    const body = JSON.stringify({ commit_id: draftCommitOf(marked), event: payload.event, body: payload.body, comments: payload.comments })
    const folder = await mkdtemp(join(tmpdir(), 'worfy-review-'))
    try {
      const file = join(folder, 'review.json')
      await writeFile(file, body)
      let printed: string
      try {
        printed = await this.options.run(['api', '--method', 'POST', `repos/${repo}/pulls/${pr}/reviews`, '--input', file], root, env, 'all')
      } catch (error) {
        this.health.failed(root, messageOf(error))
        const refused = refusedByGithub(error)
        const reason = refused !== null ? `GitHub refused the review: ${refused}` : `${UNCONFIRMED}: ${firstLine(messageOf(error))}. Submit again: worfy first looks whether it is on GitHub already`
        await this.options.drafts
          .changeNow(root, repo, pr, (current) => {
            if (current === null || current.state !== 'submitting') throw new Error('not submitting')
            return { ...current, state: 'draft', error: reason }
          })
          .catch(() => undefined)
        return answer('failed', reason)
      }
      this.health.answered(root)
      const url = urlOf(printed)
      return answer('submitted', await this.markSubmitted(root, repo, pr, url), { reviewUrl: url })
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }

  /** Marks the draft submitted; null when it is, else why the file could not say so (the review is on GitHub either way). */
  private async markSubmitted(root: string, repo: string, pr: number, url: string | null): Promise<string | null> {
    try {
      const done = await this.options.drafts.changeNow(root, repo, pr, (current) => {
        if (current === null) throw new Error('the draft is gone')
        const next: ReviewDraft = { ...current, state: 'submitted', submittedAt: new Date().toISOString() }
        delete next.error
        if (url === null) delete next.reviewUrl
        else next.reviewUrl = url
        return next
      })
      if (done.problem !== null) return `Submitted, but the draft file does not say so yet: ${done.problem}`
      return null
    } catch (error) {
      return `Submitted, but the draft file does not say so: ${messageOf(error)}`
    }
  }

  /** The review of `account` on `commit` with these texts, when GitHub lists one; null when it lists none. */
  private async posted(get: (path: string) => Promise<string>, repo: string, pr: number, account: string, commit: string, texts: SubmittedTexts): Promise<{ url: string | null } | null> {
    for (let page = 1; page <= REVIEW_PAGES_MAX; page++) {
      const reviews = z.array(reviewSchema).parse(JSON.parse(await get(`repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${page}`)))
      const found = reviews.find(
        (review) =>
          review.user?.login?.toLowerCase() === account.toLowerCase() && review.commit_id != null && sameSha(review.commit_id, commit) && sameText(review.body ?? '', texts.body) && STATES[texts.event].includes(review.state ?? ''),
      )
      if (found !== undefined) return { url: found.html_url ?? null }
      if (reviews.length < 100) return null
    }
    return null
  }

  /**
   * The comments GitHub would refuse on the diff of `pr` at its commit: a file not in it or without lines, a line not
   * in a hunk, a range across hunks. Reads `pulls/{n}/files` when the commit is the head, else
   * `compare/{base}...{commit}`.
   */
  private async offLines(comments: readonly ReviewComment[], reader: GhReader, pr: ChangesPrRef, atHead: boolean): Promise<string[]> {
    if (comments.length === 0) return []
    let listing
    try {
      listing = await this.diffs.files(reader, pr, atHead ? { kind: 'all' } : { kind: 'compare', repo: pr.repo, ref: pr.baseOid })
    } catch (error) {
      throw new Refusal(`Not submitted: worfy could not read the diff of ${pr.repo}#${pr.number} on GitHub: ${firstLine(messageOf(error))}`)
    }
    const hunks = new Map<string, DiffHunk[] | null>()
    for (const each of listing.files) hunks.set(each.file.path, each.patch === null ? null : patchHunks(each.patch))
    const off: string[] = []
    for (const comment of comments) {
      const file = hunks.get(comment.path)
      if (file === undefined) off.push(`${whereOf(comment)} is not a file of the diff`)
      else if (file === null) off.push(`${whereOf(comment)} is in a file GitHub shows no lines of`)
      else {
        const last = hunkOf(file, comment.side, comment.line)
        if (last === -1) off.push(`${whereOf(comment)} is not on a changed line`)
        else if (comment.start_line !== undefined && hunkOf(file, comment.start_side ?? comment.side, comment.start_line) !== last) off.push(`${whereOf(comment)} covers lines of two hunks`)
      }
    }
    return off
  }

  private async read(root: string, repo: string, pr: number): Promise<ReviewDraft> {
    const read = await this.options.drafts.draft(root, repo, pr)
    if (read.problem !== null) throw new Refusal(`Not submitted: ${read.problem}`)
    if (read.draft === null) throw new Refusal(`Not submitted: there is no review draft of ${repo}#${pr}`)
    return read.draft
  }

  private async lint(root: string, texts: SubmittedTexts): Promise<{ kind: 'clean' } | { kind: 'findings'; findings: string[] } | { kind: 'broken'; reason: string }> {
    const folder = await this.options.profileDir(root)
    const rules = folder.dir === null ? null : lintRulesPath(folder.dir)
    const draft = JSON.stringify({ payload: { event: texts.event, body: texts.body, comments: texts.comments } })
    let run: LintRun
    try {
      run = await this.options.lint(draft, root, rules !== null && existsSync(rules) ? rules : null)
    } catch (error) {
      return { kind: 'broken', reason: `Not submitted: review-draft-lint could not run: ${messageOf(error)}` }
    }
    if (run.code === 1) return { kind: 'findings', findings: run.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '') }
    // Clean means these texts were checked; anything else is no check at all.
    if (run.code !== 0 || !/clean \(/u.test(run.stdout)) return { kind: 'broken', reason: `Not submitted: review-draft-lint gave exit ${run.code ?? 'none'}${firstLine(run.stderr) ? `: ${firstLine(run.stderr)}` : ''}` }
    return { kind: 'clean' }
  }
}

/**
 * The texts that go, checked against the draft: a draft submitted or written by the agent now, a commit or a text the
 * file does not hold, a verdict GitHub refuses without a text — refused.
 */
function textsOf(draft: ReviewDraft, input: SubmittedTexts & { commit: string }): SubmittedTexts {
  if (draft.state === 'submitted') throw new Refusal(`Submitted already${draft.reviewUrl === undefined ? '' : `: ${draft.reviewUrl}`}`)
  if (draft.agent?.state === 'writing') throw new Refusal(AGENT_WRITING)
  const commit = draftCommitOf(draft)
  if (!sameSha(commit, input.commit)) throw new Refusal(`Not submitted: the comments are on ${commit.slice(0, 7)} now, not on ${input.commit.slice(0, 7)}. Look at them again`)
  const texts: SubmittedTexts = { event: input.event, body: input.body, comments: input.comments }
  if (input.event !== 'APPROVE' && input.body.trim() === '' && input.comments.length === 0) throw new Refusal(NEEDS_TEXT)
  if (draft.state === 'submitting') {
    // The texts of the Submit that did not finish, and no others: they may be on GitHub already.
    const was = draft.payload
    const same = was.event === input.event && was.body === input.body && was.comments.length === input.comments.length && was.comments.every((comment, at) => sameComment(comment, input.comments[at]!))
    if (!same) throw new Refusal(`Not submitted: a Submit of other texts did not finish. ${UNCONFIRMED}: Submit those, and worfy first looks whether they are on GitHub`)
    return texts
  }
  const taken = new Set<number>()
  for (const comment of input.comments) {
    const at = draft.payload.comments.findIndex((each, index) => !taken.has(index) && sameComment(each, comment))
    if (at === -1) throw new Refusal(`Not submitted: the draft changed meanwhile — ${whereOf(comment)} is not in it as shown. Look at it again`)
    taken.add(at)
  }
  return texts
}

/** The draft marked `submitting`, holding exactly the texts that go: the comments shown, in their order, with their anchors. */
function markSubmitting(current: ReviewDraft | null, texts: SubmittedTexts, commit: string): ReviewDraft {
  if (current === null) throw new Refusal('There is no review draft')
  if (current.state === 'submitted') throw new Refusal('Submitted already')
  if (current.agent?.state === 'writing') throw new Refusal(AGENT_WRITING)
  if (!sameSha(draftCommitOf(current), commit)) throw new Refusal('The comments moved meanwhile')
  const anchors: ReviewDraft['anchors'] = []
  const taken = new Set<number>()
  for (const comment of texts.comments) {
    const at = current.payload.comments.findIndex((each, index) => !taken.has(index) && sameComment(each, comment))
    if (at === -1) throw new Refusal('The draft changed meanwhile')
    taken.add(at)
    anchors.push(current.anchors[at]!)
  }
  const next: ReviewDraft = {
    ...current,
    state: 'submitting',
    payload: { ...current.payload, event: texts.event, body: texts.body, comments: texts.comments.map((comment) => ({ ...comment })) },
    anchors,
    ...(texts.body === current.payload.body ? {} : { bodyBy: 'person' as const }),
  }
  delete next.error
  return next
}

/** The hunk `line` of `side` is in, by its place; -1 when it is in none. */
function hunkOf(hunks: readonly DiffHunk[], side: ReviewComment['side'], line: number): number {
  return hunks.findIndex((hunk) => hunk.lines.some((each) => (side === 'RIGHT' ? each.kind !== 'del' && each.newLine === line : each.kind !== 'add' && each.oldLine === line)))
}

/** GitHub's reason when it refused the request (an HTTP status 4xx but 408): nothing was created then. Null otherwise. */
function refusedByGithub(error: unknown): string | null {
  const status = /\(HTTP (\d{3})\)/u.exec(messageOf(error))?.[1]
  if (status === undefined || !status.startsWith('4') || status === '408') return null
  const said = error instanceof GhExitError ? githubMessage(error.output) : null
  return said ?? firstLine(messageOf(error))
}

/** The `message` of GitHub's error body, with the messages of its `errors`; null without one. */
function githubMessage(output: string): string | null {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = z.object({ message: z.string(), errors: z.array(z.union([z.string(), z.object({ message: z.string() }).loose()])).optional() }).loose().parse(JSON.parse(output.slice(start, end + 1)))
    const more = (parsed.errors ?? []).map((each) => (typeof each === 'string' ? each : each.message))
    return [parsed.message, ...more].join(': ')
  } catch {
    return null
  }
}

/** `html_url` of the review GitHub created; null when the answer has none. */
function urlOf(printed: string): string | null {
  const start = printed.indexOf('{')
  const end = printed.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const url: unknown = (JSON.parse(printed.slice(start, end + 1)) as { html_url?: unknown }).html_url
    return typeof url === 'string' && url.startsWith('https://') ? url : null
  } catch {
    return null
  }
}

const pullSchema = z.object({ head: z.object({ sha: z.string().min(7) }).loose(), base: z.object({ sha: z.string().min(7) }).loose(), user: z.object({ login: z.string() }).loose().nullish() }).loose()
type PullNow = z.infer<typeof pullSchema>

const reviewSchema = z.object({ user: z.object({ login: z.string() }).loose().nullish(), body: z.string().nullish(), state: z.string().nullish(), html_url: z.string().nullish(), commit_id: z.string().nullish() }).loose()
