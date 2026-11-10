// The drafts of replies of a PR and Send (worfy-pr-inbox ticket 05, ADR-0105): the one module of main that writes to
// GitHub, and only on the user's click.
//
// - Drafts: skill pr-reply writes them through harness/bin/pr-reply-draft into
//   `<Profile folder>/state/pr-inbox/drafts/<owner>-<name>-<N>.json`, on this machine only. Main reads that file, and
//   writes into it only the user's text of a reply (`edited: true`), a discard, the reason a Send failed (`error`)
//   and the mark of a sent reply (`state: "sent"`, `sentUrl`). A write goes through a temporary file beside it and a
//   rename, and only when the file is still what was read: a Session that wrote new drafts meanwhile is not
//   overwritten. One change of a file at a time, in this process.
// - Send of one reply, in this order: the text the user sees in the field is saved into the file; the file is read
//   again and its text taken as it is; `review-draft-lint --reply` checks that text (traces of the workflow, AI
//   authorship, personal data, length) — a finding, or a lint that could not run, and nothing is posted; GitHub is
//   asked whether this account has posted this very text there already (a Send whose answer was lost) — then the
//   reply is only marked sent; otherwise one POST, with GH_TOKEN of the Project's account, whose body is the text,
//   without a byte added:
//   - a reply in a review thread: `POST repos/{o}/{r}/pulls/{n}/comments/{replyTo}/replies`;
//   - a reply in the conversation: `POST repos/{o}/{r}/issues/{n}/comments`.
//   A failure of GitHub or the network leaves the reply a draft with the reason; it is never retried by itself.
// - Send all: the same, one reply after another, at most POSTS_PER_MINUTE posts a minute (GitHub's limit on creating
//   content); the first failure of GitHub stops the rest.
// - Nothing else ever: no resolve, no review request, no review, no pending review, no "read" mark, no push.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { PR_REPLY_STATES, type PrReplyDrafts, type PrReplyItem, type PrReplyRef, type PrReplySendResult } from '../../shared/ipc/pr-inbox'
import type { GhEnv, GhRunner } from './prs'

/** GitHub's limit of posts that create content, per minute (docs.github.com, "secondary rate limits"). */
export const POSTS_PER_MINUTE = 80
const MINUTE_MS = 60_000
/** How many comments of a thread or of the conversation are read to find a reply posted before. */
const LOOK_BACK = 100

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u
/** The fields of a reply the draft format has (harness/bin/review-draft-lint, `--reply`); the lint refuses any other. */
const ITEM_FIELDS = ['kind', 'threadId', 'replyTo', 'label', 'body', 'fixPlan', 'state', 'sentUrl', 'error', 'edited'] as const

/** The draft file of the PR `repo`#`pr` in the Profile folder `profileDir`. */
export function draftFilePath(profileDir: string, repo: string, pr: number): string {
  const [owner, name] = repo.split('/')
  return join(profileDir, 'state', 'pr-inbox', 'drafts', `${owner}-${name}-${pr}.json`)
}

/** The limits of the Project's team reviewer, when it is built: pr-reply-draft checks with them too. */
export const lintRulesPath = (profileDir: string): string => join(profileDir, 'state', 'human-review', 'lint.json')

// ── the draft file ───────────────────────────────────────────────────────────

const rawItemSchema = z
  .object({
    kind: z.enum(['thread', 'conversation']),
    threadId: z.string().nullish(),
    replyTo: z.number().int().positive().nullish(),
    label: z.string(),
    body: z.string(),
    fixPlan: z.string().nullish(),
    state: z.enum(PR_REPLY_STATES),
    sentUrl: z.string().nullish(),
    error: z.string().nullish(),
    edited: z.boolean().optional(),
  })
  .loose()
type RawItem = z.infer<typeof rawItemSchema>

const rawFileSchema = z.object({ schema: z.literal(1), repo: z.string(), pr: z.number().int().positive(), headOid: z.string(), items: z.array(rawItemSchema) }).loose()
type RawFile = z.infer<typeof rawFileSchema>

/** A refusal whose message is meant for the user as it is. */
export class DraftRefusal extends Error {}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const firstLine = (text: string): string => text.trim().split('\n')[0]?.trim() ?? ''

function itemView(item: RawItem, index: number): PrReplyItem {
  return {
    index,
    kind: item.kind,
    threadId: item.threadId ?? null,
    replyTo: item.replyTo ?? null,
    label: item.label,
    body: item.body,
    fixPlan: item.fixPlan ?? null,
    state: item.state,
    sentUrl: item.sentUrl ?? null,
    error: item.error ?? null,
    edited: item.edited === true,
  }
}

function parseFile(text: string, file: string, repo: string, pr: number): RawFile {
  let json: unknown
  try {
    // A UTF-8 byte order mark at the start is dropped, as pr-reply-draft does.
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (error) {
    throw new DraftRefusal(`The draft file ${file} is not JSON: ${messageOf(error)}`)
  }
  const parsed = rawFileSchema.safeParse(json)
  if (!parsed.success) throw new DraftRefusal(`The draft file ${file} is not a draft of replies: ${parsed.error.issues[0]?.message ?? 'wrong shape'}`)
  if (parsed.data.repo.toLowerCase() !== repo.toLowerCase() || parsed.data.pr !== pr) throw new DraftRefusal(`The draft file ${file} is of ${parsed.data.repo}#${parsed.data.pr}, not of ${repo}#${pr}`)
  return parsed.data
}

/** The reply `ref` names, when the file still has it at that place with that kind and thread. */
function itemAt(raw: RawFile, ref: PrReplyRef): RawItem {
  const item = raw.items[ref.index]
  if (item === undefined || item.kind !== ref.kind || (item.threadId ?? null) !== ref.threadId)
    throw new DraftRefusal('The drafts changed meanwhile (the Session wrote new ones): look at them again')
  return item
}

/** The reply as review-draft-lint takes it: the fields of the format only. */
function lintItem(item: RawItem): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of ITEM_FIELDS) if (item[field] !== undefined) out[field] = item[field]
  return out
}

// ── the sender ───────────────────────────────────────────────────────────────

/** One run of review-draft-lint: its exit code (null when it did not finish) and output. */
export interface LintRun {
  code: number | null
  stdout: string
  stderr: string
}

export interface PrReplySenderOptions {
  /** gh, as the PR inbox runs it; WORFY_GH points it at a stand-in in tests. */
  run: GhRunner
  /** GH_TOKEN of the Project's GitHub account (accountAuth); rejects when gh has no login for it. */
  auth: (root: string) => Promise<GhEnv>
  /** The Project's Profile folder (readProfileFolder): null, with the reason, when it has none. */
  profileDir: (root: string) => Promise<{ dir: string | null; reason: string | null }>
  /** The Project's repositories on GitHub, `owner/name` (remoteRepos): a reply goes to one of them only. */
  repos: (root: string) => Promise<readonly string[]>
  /** `review-draft-lint --reply - -C <root> [--rules <rules>]` with `draft` on its stdin. */
  lint: (draft: string, root: string, rules: string | null) => Promise<LintRun>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

interface SendContext {
  root: string
  repo: string
  pr: number
  file: string
  rules: string | null
}

export class PrReplySender {
  /** The change of each draft file running now: one at a time per file. */
  private readonly queues = new Map<string, Promise<unknown>>()
  /** When the posts of the last minute went out, oldest first. */
  private readonly posts: number[] = []
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: PrReplySenderOptions) {
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => delay(ms))
  }

  /** The drafts of `repo`#`pr` for the Project at `root`: none without a file, a problem without a Profile folder or with a broken file. */
  async drafts(root: string, repo: string, pr: number): Promise<PrReplyDrafts> {
    const empty: PrReplyDrafts = { repo, pr, headOid: null, items: [], problem: null }
    const folder = await this.options.profileDir(root)
    if (folder.dir === null) return { ...empty, problem: `The Project has no Profile folder, where drafts live: ${folder.reason ?? 'unknown'}` }
    const file = draftFilePath(folder.dir, repo, pr)
    try {
      const text = await this.read(file)
      return text === null ? empty : this.view(parseFile(text, file, repo, pr), repo, pr)
    } catch (error) {
      return { ...empty, problem: messageOf(error) }
    }
  }

  /** The user's text of one reply into the file, as it is; the reply becomes `edited`. Never reaches GitHub. */
  async save(root: string, repo: string, pr: number, ref: PrReplyRef, body: string): Promise<PrReplyDrafts> {
    const context = await this.context(root, repo, pr)
    return this.exclusive(context.file, async () => {
      await this.update(context, (raw) => {
        const item = itemAt(raw, ref)
        if (item.state !== 'draft') throw new DraftRefusal(`This reply is ${item.state}: it is not edited any more`)
        if (item.body === body) return false
        item.body = body
        item.edited = true
        return true
      })
      return this.drafts(root, repo, pr)
    })
  }

  /** The reply will not be sent. Never reaches GitHub. */
  async discard(root: string, repo: string, pr: number, ref: PrReplyRef): Promise<PrReplyDrafts> {
    const context = await this.context(root, repo, pr)
    return this.exclusive(context.file, async () => {
      await this.update(context, (raw) => {
        const item = itemAt(raw, ref)
        if (item.state === 'sent') throw new DraftRefusal('This reply is sent already: it cannot be discarded')
        if (item.state === 'discarded') return false
        item.state = 'discarded'
        return true
      })
      return this.drafts(root, repo, pr)
    })
  }

  /**
   * Send, on the user's click: each reply with the text the user sees, one after another. The first failure of GitHub
   * or of the account stops the rest (`skipped`); a refusal of one reply (a lint finding) does not.
   */
  async send(root: string, repo: string, pr: number, items: readonly (PrReplyRef & { body: string })[]): Promise<{ results: PrReplySendResult[]; drafts: PrReplyDrafts }> {
    const context = await this.context(root, repo, pr)
    const projectRepos = await this.options.repos(root)
    if (!projectRepos.some((each) => each.toLowerCase() === repo.toLowerCase())) throw new DraftRefusal(`${repo} is not a repository of this Project: nothing is sent`)
    return this.exclusive(context.file, async () => {
      const results: PrReplySendResult[] = []
      let stopped = false
      for (const item of items) {
        if (stopped) {
          results.push({ index: item.index, outcome: 'skipped', reason: 'Not sent: an earlier reply of this Send failed', sentUrl: null })
          continue
        }
        const result = await this.sendOne(context, item, item.body)
        results.push(result)
        if (result.outcome === 'failed') stopped = true
      }
      return { results, drafts: await this.drafts(root, repo, pr) }
    })
  }

  // ── one reply ──────────────────────────────────────────────────────────────

  private async sendOne(context: SendContext, ref: PrReplyRef, shown: string): Promise<PrReplySendResult> {
    const result = (outcome: PrReplySendResult['outcome'], reason: string | null, sentUrl: string | null = null): PrReplySendResult => ({ index: ref.index, outcome, reason, sentUrl })
    // The reason a reply was not posted stays in the file with it, so the view shows it after a restart too.
    const refuse = async (outcome: 'refused' | 'failed', reason: string): Promise<PrReplySendResult> => {
      await this.update(context, (raw) => {
        const item = itemAt(raw, ref)
        if (item.state !== 'draft' || item.error === reason) return false
        item.error = reason
        return true
      }).catch(() => undefined)
      return result(outcome, reason)
    }

    // 1. The text shown goes into the file first: what is posted is what the file then holds.
    let item: RawItem
    let raw: RawFile
    try {
      await this.update(context, (file) => {
        const each = itemAt(file, ref)
        if (each.state !== 'draft' || each.body === shown) return false
        each.body = shown
        each.edited = true
        return true
      })
      // 2. Read again: the text is taken from the file as it is.
      raw = await this.load(context)
      item = itemAt(raw, ref)
    } catch (error) {
      return result('refused', messageOf(error))
    }
    if (item.state === 'sent') return result('refused', `Sent already${item.sentUrl ? `: ${item.sentUrl}` : ''}`)
    if (item.state === 'discarded') return result('refused', 'This reply is discarded')
    const body = item.body
    if (body !== shown) return result('refused', 'The draft file changed meanwhile: look at the reply again')
    if (item.kind === 'thread' && (item.threadId == null || item.replyTo == null)) return refuse('refused', 'Not sent: the draft names no comment of the thread to reply to')

    // 3. The check, again, over this very text.
    const lint = await this.lint(context, raw, item)
    if (lint !== null) return refuse('refused', lint)

    // 4. As the Project's account.
    let env: GhEnv
    try {
      env = await this.options.auth(context.root)
    } catch (error) {
      return refuse('failed', `Not sent: ${messageOf(error)}`)
    }

    // 5. Posted before, with the answer lost: only the mark.
    let posted: string | null | undefined
    try {
      posted = await this.postedBefore(context, item, body, env)
    } catch (error) {
      return refuse('failed', `Not sent: worfy could not check whether this reply is on GitHub already: ${messageOf(error)}`)
    }
    if (posted !== undefined) {
      const marked = await this.markSent(context, ref, body, posted)
      return result('already-sent', marked ?? 'It was on GitHub already: marked sent, not posted again', posted)
    }

    // 6. One POST, the text as its body.
    await this.pace()
    const path = item.kind === 'thread' ? `repos/${context.repo}/pulls/${context.pr}/comments/${item.replyTo}/replies` : `repos/${context.repo}/issues/${context.pr}/comments`
    let answer: string
    try {
      this.posts.push(this.now())
      answer = await this.options.run(['api', '--method', 'POST', path, '-f', `body=${body}`], context.root, env)
    } catch (error) {
      return refuse('failed', `GitHub did not confirm the reply: ${firstLine(messageOf(error))}. Send again: worfy first looks whether it is on GitHub already`)
    }
    const url = urlOf(answer)
    const marked = await this.markSent(context, ref, body, url)
    return result('sent', marked, url)
  }

  /** Null when review-draft-lint passed the reply; otherwise why it is not posted. */
  private async lint(context: SendContext, raw: RawFile, item: RawItem): Promise<string | null> {
    const draft = JSON.stringify({ schema: 1, repo: raw.repo, pr: raw.pr, headOid: raw.headOid, items: [lintItem(item)] })
    let run: LintRun
    try {
      run = await this.options.lint(draft, context.root, context.rules)
    } catch (error) {
      return `Not sent: review-draft-lint could not run: ${messageOf(error)}`
    }
    if (run.code === 1) {
      const found = run.stdout
        .split('\n')
        .map((line) => line.trim().replace(/^items\[0\]:\s*/u, ''))
        .filter((line) => line !== '')
      return `Not sent: review-draft-lint found ${found.join('; ')}`
    }
    // Clean means this one reply was checked; anything else is no check at all.
    if (run.code !== 0 || !/clean \(1 repl/u.test(run.stdout)) return `Not sent: review-draft-lint gave exit ${run.code ?? 'none'}${firstLine(run.stderr) ? `: ${firstLine(run.stderr)}` : ''}`
    return null
  }

  /**
   * The URL of a comment of this account on GitHub whose text is `body` — in the thread, or in the conversation —
   * or null when it has none; undefined when there is no such comment. Reads only: one GraphQL query.
   */
  private async postedBefore(context: SendContext, item: RawItem, body: string, env: GhEnv): Promise<string | null | undefined> {
    const [owner, name] = context.repo.split('/') as [string, string]
    const args =
      item.kind === 'thread'
        ? ['api', 'graphql', '-f', `query=${THREAD_QUERY}`, '-f', `thread=${item.threadId ?? ''}`]
        : ['api', 'graphql', '-f', `query=${CONVERSATION_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${context.pr}`]
    const parsed = postedSchema.safeParse(JSON.parse(await this.options.run(args, context.root, env)))
    if (!parsed.success) throw new Error('GitHub answered in an unexpected shape')
    const { viewer, node, repository } = parsed.data.data
    const comments = item.kind === 'thread' ? node?.comments?.nodes : repository?.pullRequest?.comments?.nodes
    if (comments === undefined || comments === null) throw new Error(item.kind === 'thread' ? 'the thread is not on GitHub' : 'the pull request is not on GitHub')
    const found = comments.find((comment) => comment?.author?.login === viewer.login && sameText(comment.body, body))
    return found === undefined || found === null ? undefined : (found.url ?? null)
  }

  /** Marks the reply sent; null when it is, else why the file could not say so (the reply is on GitHub either way). */
  private async markSent(context: SendContext, ref: PrReplyRef, body: string, url: string | null): Promise<string | null> {
    try {
      await this.update(context, (raw) => {
        // A Session that rewrote the drafts meanwhile may have moved the reply: found again by its thread and text.
        const at = raw.items[ref.index]
        const item = at !== undefined && at.kind === ref.kind && (at.threadId ?? null) === ref.threadId ? at : raw.items.find((each) => each.kind === ref.kind && (each.threadId ?? null) === ref.threadId && each.body === body)
        if (item === undefined) throw new DraftRefusal('the reply is not in the draft file any more')
        item.state = 'sent'
        item.sentUrl = url
        item.error = null
        return true
      })
      return null
    } catch (error) {
      return `Posted, but the draft file does not say so: ${messageOf(error)}`
    }
  }

  /** Waits until a post more stays within POSTS_PER_MINUTE. */
  private async pace(): Promise<void> {
    for (;;) {
      const now = this.now()
      while (this.posts.length > 0 && (this.posts[0] ?? 0) <= now - MINUTE_MS) this.posts.shift()
      if (this.posts.length < POSTS_PER_MINUTE) return
      await this.sleep((this.posts[0] ?? now) + MINUTE_MS - now)
    }
  }

  // ── the file ───────────────────────────────────────────────────────────────

  private async context(root: string, repo: string, pr: number): Promise<SendContext> {
    if (!REPO.test(repo)) throw new DraftRefusal(`Not a repository on GitHub: ${repo}`)
    const folder = await this.options.profileDir(root)
    if (folder.dir === null) throw new DraftRefusal(`The Project has no Profile folder, where drafts live: ${folder.reason ?? 'unknown'}`)
    const rules = lintRulesPath(folder.dir)
    return { root, repo, pr, file: draftFilePath(folder.dir, repo, pr), rules: existsSync(rules) ? rules : null }
  }

  private async read(file: string): Promise<string | null> {
    try {
      return await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new DraftRefusal(`The draft file ${file} cannot be read: ${messageOf(error)}`)
    }
  }

  private async load(context: SendContext): Promise<RawFile> {
    const text = await this.read(context.file)
    if (text === null) throw new DraftRefusal(`There are no drafts of ${context.repo}#${context.pr}`)
    return parseFile(text, context.file, context.repo, context.pr)
  }

  /**
   * Changes the file by `change` (false: nothing to change) through a temporary file and a rename, only while the
   * file is still what was read; a file a Session wrote meanwhile is read again, three times at most.
   */
  private async update(context: SendContext, change: (raw: RawFile) => boolean): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const before = await this.read(context.file)
      if (before === null) throw new DraftRefusal(`There are no drafts of ${context.repo}#${context.pr}`)
      const raw = parseFile(before, context.file, context.repo, context.pr)
      if (!change(raw)) return
      const tmp = `${context.file}.${randomUUID()}.tmp`
      await mkdir(join(context.file, '..'), { recursive: true })
      try {
        await writeFile(tmp, `${JSON.stringify(raw, null, 2)}\n`)
        if ((await this.read(context.file)) !== before) {
          if (attempt < 3) continue
          throw new DraftRefusal('The draft file kept changing (a Session writes drafts): try again')
        }
        await rename(tmp, context.file)
        return
      } finally {
        await rm(tmp, { force: true })
      }
    }
  }

  private view(raw: RawFile, repo: string, pr: number): PrReplyDrafts {
    return { repo, pr, headOid: raw.headOid, items: raw.items.map(itemView), problem: null }
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

// ── GitHub's answers ─────────────────────────────────────────────────────────

const COMMENTS = `comments(last: ${LOOK_BACK}) { nodes { author { login } body url } }`
/** The comments of one review thread, and the login of the token. */
export const THREAD_QUERY = `query($thread: ID!) { viewer { login } node(id: $thread) { ... on PullRequestReviewThread { ${COMMENTS} } } }`
/** The comments of a PR's conversation, and the login of the token. */
export const CONVERSATION_QUERY = `query($owner: String!, $name: String!, $number: Int!) { viewer { login } repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${COMMENTS} } } }`

const commentNodes = z
  .object({ nodes: z.array(z.object({ author: z.object({ login: z.string() }).nullish(), body: z.string(), url: z.string().nullish() }).nullable()).nullish() })
  .nullish()
const postedSchema = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }),
    node: z.object({ comments: commentNodes }).nullish(),
    repository: z.object({ pullRequest: z.object({ comments: commentNodes }).nullish() }).nullish(),
  }),
})

/** GitHub keeps a body as sent, but line ends may come back as LF and trailing white space may go. */
const sameText = (a: string, b: string): boolean => a.replace(/\r\n/gu, '\n').trimEnd() === b.replace(/\r\n/gu, '\n').trimEnd()

/** `html_url` of the comment GitHub created; null when the answer has none. */
function urlOf(answer: string): string | null {
  try {
    const url: unknown = (JSON.parse(answer) as { html_url?: unknown }).html_url
    return typeof url === 'string' && url.startsWith('https://') ? url : null
  } catch {
    return null
  }
}
