// Allow verification change (worfy-harness-guarantees ticket 10; the spec of that Epic, Q3 (a)): the owner's mark on a
// PR that adds a verification path to the trail of a Ticket, or that has no Ticket and changes one — the commit status
// `owner` success on the PR's head, which harness/bin/land waits for before it merges such a PR. The fourth write of
// main to GitHub, beside the replies of pr-reply-send.ts (ADR-0105) and the review of pr-review-submit.ts (ADR-0112),
// and built the same way: look, check, one POST, only on the owner's click.
//
// - Look (`look`): what the mark is about, read by the Harness's own rule — `land --verification <N>` (the caller's
//   `verification`), never a second copy of it here. Reads only: opening the view of a PR, or reading it again, writes
//   nothing to GitHub.
// - Allow (`allow`), in this order, one at a time per PR: the Project's account is the one the Profile names
//   (`github.account`) — none named, and nothing is written; the PR is read again as it is now; it must still be open
//   and still need the mark, on the very head the view showed — a head that moved is refused with the head now, since
//   the mark of one commit says nothing of the next; a head whose `owner` status is success already is only answered
//   `already` (a second click, or a click after a lost answer, writes nothing); then one POST
//   `repos/{o}/{r}/statuses/{head}` with state success, context `owner` and a description, with GH_TOKEN of that
//   account. A failure of GitHub or the network is answered with its reason and never retried by itself; the next click
//   looks again first.
// - Never: any other context or state, a status on another commit, a merge, a comment, a review. No agent reaches this
//   module: the channel is `local`, and the guard refuses an agent's own `gh api …/statuses` with context `owner`.
import { z } from 'zod'
import type { OwnerMarkLook, OwnerMarkResult } from '../../shared/ipc/pr-inbox'
import { NO_GITHUB_HEALTH, type GithubHealth } from './github-health'
import { accountAuth, type GhEnv, type GhRunner } from './prs'

/** The context of the owner's mark, as harness/bin/land reads it (OWNER_MARK). */
export const OWNER_CONTEXT = 'owner'
/** The description of the status: GitHub keeps at most 140 characters of it. */
export const OWNER_DESCRIPTION = 'Verification change allowed by the owner in worfy'

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u
const SHA = /^[0-9a-f]{40}$/u

/** One line of `land --verification <N>` (harness/bin/land, verificationOne). */
const answerSchema = z.object({
  pr: z.number().int().positive(),
  head: z.string().regex(SHA).nullish(),
  state: z.string().optional(),
  owner: z.string().nullish(),
  needsOwner: z.boolean().optional(),
  added: z.array(z.object({ file: z.string(), ticket: z.string().nullable(), paths: z.array(z.string()) })).optional(),
  noTicket: z.object({ reason: z.string().nullish(), paths: z.array(z.string()) }).nullish(),
  error: z.string().optional(),
})
export type VerificationAnswer = z.infer<typeof answerSchema>

/** The run of `land --verification`: its exit code and what it printed. */
export interface VerificationRun {
  code: number | null
  stdout: string
  stderr: string
}

export interface OwnerMarkOptions {
  /** gh: the PR inbox's. */
  run: GhRunner
  /** The Project's GitHub account from its Profile; null when it names none. */
  account: (root: string) => Promise<string | null>
  /**
   * `land --verification <number>` in the Project's folder of `repo`, with `env` (GH_TOKEN of the Project's account)
   * over the Harness scripts' environment. Throws when it cannot start.
   */
  verification: (root: string, repo: string, number: number, env: GhEnv) => Promise<VerificationRun>
  health?: GithubHealth
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const short = (sha: string): string => sha.slice(0, 8)
const firstLine = (text: string): string => text.trim().split(/\r?\n/u)[0]?.trim() ?? ''

/** What the view shows of an answer of land. */
export function lookOf(answer: VerificationAnswer): OwnerMarkLook {
  if (answer.error !== undefined) return { needed: false, head: answer.head ?? null, lines: [], allowed: false, error: answer.error }
  const lines = [
    ...(answer.added ?? []).map((entry) => `adds ${entry.paths.join(', ')} to the trail of ${entry.ticket ?? entry.file}`),
    ...(answer.noTicket == null ? [] : [`changes ${answer.noTicket.paths.join(', ')}, and the PR has no Ticket`]),
  ]
  const needed = answer.needsOwner === true && answer.state === 'OPEN' && typeof answer.head === 'string'
  return { needed, head: answer.head ?? null, lines: needed ? lines : [], allowed: needed && answer.owner === 'success', error: null }
}

const failedLook = (error: string): OwnerMarkLook => ({ needed: false, head: null, lines: [], allowed: false, error })

/** The owner's mark of the PRs of this machine's Projects: look, and Allow verification change on the owner's click. */
export class OwnerMark {
  private readonly health: GithubHealth
  /** The PRs whose Allow runs now (`<root> <repo>#<n>`): a second click waits for nothing and writes nothing. */
  private readonly inFlight = new Set<string>()

  constructor(private readonly options: OwnerMarkOptions) {
    this.health = options.health ?? NO_GITHUB_HEALTH
  }

  /** What the owner's mark of `repo`#`number` is about now. Reads only; a failure is the look's `error`. */
  async look(root: string, repo: string, number: number): Promise<OwnerMarkLook> {
    if (!REPO.test(repo)) return failedLook(`not a repository: ${repo}`)
    try {
      const account = await this.options.account(root)
      const env = account === null ? {} : await this.auth(root, account)
      return lookOf(await this.read(root, repo, number, env))
    } catch (error) {
      return failedLook(messageOf(error))
    }
  }

  /** Allow verification change on `head`, the head the view showed: the order of the header of this file. */
  async allow(root: string, repo: string, number: number, head: string): Promise<OwnerMarkResult> {
    const refused = (reason: string, look: OwnerMarkLook = failedLook(reason)): OwnerMarkResult => ({ outcome: 'refused', reason, look })
    if (!REPO.test(repo)) return refused(`not a repository: ${repo}`)
    if (!SHA.test(head)) return refused(`not a commit: ${head}`)
    const key = `${root} ${repo}#${String(number)}`
    if (this.inFlight.has(key)) return refused('Allow verification change of this PR is already under way')
    this.inFlight.add(key)
    try {
      const account = await this.options.account(root)
      if (account === null) {
        const reason = "The Project's Profile names no github.account: nothing is written to GitHub"
        this.health.signInFailed(root, reason)
        return refused(reason)
      }
      let env: GhEnv
      let look: OwnerMarkLook
      try {
        env = await this.auth(root, account)
        look = lookOf(await this.read(root, repo, number, env))
      } catch (error) {
        return refused(`The PR could not be read, nothing is written: ${messageOf(error)}`)
      }
      if (look.error !== null) return refused(`The PR could not be read, nothing is written: ${look.error}`, look)
      if (!look.needed) return refused('The PR needs no owner mark now: it is closed, or it changes no verification path that needs one', look)
      if (look.head !== head) return refused(`The PR moved to ${short(look.head ?? '')} since the view showed ${short(head)}: look at the new head first`, look)
      if (look.allowed) return { outcome: 'already', reason: null, look }
      try {
        await this.options.run(['api', '--method', 'POST', `repos/${repo}/statuses/${head}`, '-f', 'state=success', '-f', `context=${OWNER_CONTEXT}`, '-f', `description=${OWNER_DESCRIPTION}`], root, env)
      } catch (error) {
        const reason = firstLine(messageOf(error))
        this.health.failed(root, reason)
        return { outcome: 'failed', reason: `GitHub did not take the mark: ${reason}`, look }
      }
      this.health.answered(root)
      return { outcome: 'allowed', reason: null, look: { ...look, allowed: true } }
    } finally {
      this.inFlight.delete(key)
    }
  }

  private auth(root: string, account: string): Promise<GhEnv> {
    return accountAuth({ account: () => Promise.resolve(account), run: this.options.run })(root)
  }

  /** One answer of `land --verification`; throws when it gives none. */
  private async read(root: string, repo: string, number: number, env: GhEnv): Promise<VerificationAnswer> {
    const ran = await this.options.verification(root, repo, number, env)
    const line = ran.stdout.trim().split(/\r?\n/u).at(-1) ?? ''
    const parsed = ((): ReturnType<typeof answerSchema.safeParse> | null => {
      try {
        return answerSchema.safeParse(JSON.parse(line))
      } catch {
        return null
      }
    })()
    if (parsed === null || !parsed.success || parsed.data.pr !== number) throw new Error(`land --verification exit ${String(ran.code)}: ${firstLine(ran.stderr || ran.stdout) || 'no answer'}`)
    return parsed.data
  }
}
