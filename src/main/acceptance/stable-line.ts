// The Stable copy line of an Acceptance item (worfy-acceptance ticket 02; spec, "Stable copy of an item"): whether the
// change of a Ticket is in the owner's Stable copy, so the owner knows before looking whether the copy has it.
//
// - Only a Project whose repository is worfy's own (`repoUrl` of its model is UPDATE_REPO_PAGE) has a Stable copy. Any
//   other Project gets "merged #N" or "not merged", read from the model alone.
// - The commit the Stable copy runs: the file next to the copy (stableCopyPath, readStableMetadata), as Update reads it.
// - The merge commit: the PR of the Ticket's `PR:` line, else the merged PR of its branch, as the Stage finds it. A Ticket
//   that waits for the owner without a PR of its own (an acceptance Ticket) takes the merges of its blockers that are
//   done. gh runs as the Project's account (the PR tracker's `gh`), once per merged PR: a merged PR's merge commit never
//   changes, so the answer is kept for the rest of the run.
// - Whether the change is there: `git merge-base --is-ancestor <merge> <Stable copy commit>` in the Project's checkout,
//   kept for good once git says yes or no. worfy never fetches (ADR-0005): a commit this checkout does not have, a
//   refusal of GitHub and no Stable copy at all read "Stable copy not checked", and are asked again RETRY_MS later.
// - Versions: `git rev-list --count <commit>`, the build number (scripts/build-version.ts, buildNumber), with the
//   major and minor of that commit's package.json, as numberedVersion writes them. As buildNumber, a shallow clone has
//   no honest count: no number, and the line names the commit by its short SHA.
// - Update first offers Update worfy when the Available update has the change: by the build numbers when both are
//   known, else by `merge-base --is-ancestor <merge> <its commit>`; a copy that does not check for updates says so.
// Nothing is waited for: `line` answers what is known now and asks for the rest; when an answer comes, `onChange` is
// called and the caller asks again. Read-only: no gh command but `pr view` and `pr list`, no git command that writes.
import { z } from 'zod'
import type { AcceptanceStable } from '../../shared/ipc/acceptance'
import { UPDATE_REPO_PAGE, type AvailableUpdate } from '../../shared/ipc/update'
import { numberedVersion } from '../../shared/version-number'
import type { Ticket } from '../../shared/workflow/types'
import { doneOnlyInBranch } from '../../shared/workflow/waves'
import { SEARCH_INTERVAL_MS } from '../github/prs'
import { readStableMetadata, stableCopyPath } from '../update/stable-copy'
import { branchOfTicket, gitRunner, type GitRunner } from '../workflow/stages'

/** How long an answer that may change (not merged yet, not in the checkout, a refusal) is kept before it is asked again. */
export const RETRY_MS = SEARCH_INTERVAL_MS

const SHA = /^[0-9a-f]{7,40}$/u
const FULL_SHA = /^[0-9a-f]{40}$/u
/** A branch name gh is given: never an option. The rule of the fetch of the main branch (src/main/workflow/fetch.ts). */
const BRANCH = /^[\w.][\w./-]*$/u

export interface StableLineSources {
  /** A read-only gh command in the Project's root as its GitHub account: the PR tracker's `gh` (src/main/github/prs.ts). */
  gh: (root: string, args: readonly string[]) => Promise<string>
  git?: GitRunner
  /** The commit the Stable copy of this Machine runs; null without one. stableCopyCommit by default. */
  stableCommit?: () => string | null
  /**
   * Whether this copy checks for updates (its Update service is on: the Stable copy, or WORFY_UPDATE=1) and its
   * Available update (src/shared/ipc/update.ts). By default it does not check: a dev run has no Available update to know.
   */
  update?: () => { checks: boolean; available: AvailableUpdate | null }
  now?: () => number
}

/** The Project of a Ticket, with the Tickets of its model (for the blockers of an acceptance Ticket). */
export interface StableProject {
  projectId: string
  root: string
  repoUrl: string | null | undefined
  tickets: readonly Ticket[]
}

/** Whether a repository page is worfy's own: the one the Stable copy updates from. */
export function isWorfyRepo(repoUrl: string | null | undefined): boolean {
  if (!repoUrl) return false
  return repoUrl.replace(/\/+$/u, '').toLowerCase() === UPDATE_REPO_PAGE.toLowerCase()
}

/** The commit of this Machine's Stable copy from the file next to it (scripts/install-stable.mjs); null without one. */
export function stableCopyCommit(platform: NodeJS.Platform = process.platform, env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const commit = readStableMetadata(platform, stableCopyPath(platform, env))?.commit
  return commit !== undefined && SHA.test(commit) ? commit : null
}

const short = (sha: string): string => sha.slice(0, 7)
const lineOf = (state: AcceptanceStable['state'], text: string, update: AcceptanceStable['update'] = null): AcceptanceStable => ({ state, text, update })
const notChecked = (reason: string): AcceptanceStable => lineOf('not-checked', `Stable copy not checked: ${reason}`)

/** A Ticket done in the checkout: its change is merged. */
const merged = (ticket: Ticket): boolean => ticket.state === 'done' && !doneOnlyInBranch(ticket)

/** The line of a Project that has no Stable copy: from the model alone. */
function mergedLine(ticket: Ticket): AcceptanceStable {
  if (!merged(ticket)) return lineOf('not-merged', 'not merged')
  return lineOf('merged', ticket.pr ? `merged #${ticket.pr}` : 'merged')
}

/** Where a merge commit is asked for: the PR of a `PR:` line, or the merged PR of a branch. */
type MergeRef = { kind: 'pr'; pr: number } | { kind: 'branch'; branch: string }

const refOf = (ticket: Ticket): MergeRef => (ticket.pr ? { kind: 'pr', pr: ticket.pr } : { kind: 'branch', branch: branchOfTicket(ticket) })
const refKey = (ref: MergeRef): string => (ref.kind === 'pr' ? `#${ref.pr}` : `branch ${ref.branch}`)

/** The merges a Ticket's change is: its own, or for one that waits for the owner without a PR, its blockers' that are done. */
function refsOf(ticket: Ticket, tickets: readonly Ticket[]): MergeRef[] {
  if (ticket.pr || merged(ticket)) return [refOf(ticket)]
  return ticket.blockedNums.flatMap((num) => {
    const blocker = tickets.find((each) => each.epic === ticket.epic && each.num === num)
    return blocker !== undefined && merged(blocker) ? [refOf(blocker)] : []
  })
}

type Merge = { kind: 'merged'; sha: string } | { kind: 'none' } | { kind: 'failed' }
type Ancestry = 'in' | 'out' | 'missing-stable' | 'missing-merge' | 'failed'
/** A commit as a version: `0.4.<number>`, or its short SHA when the number or the version does not read. */
interface Build {
  label: string
  number: number | null
}

const pullSchema = z.object({ state: z.string().nullish(), mergeCommit: z.object({ oid: z.string() }).loose().nullish() }).loose()
const packageSchema = z.object({ version: z.string() }).loose()

/** A merged PR's merge commit, or none. */
function mergeOf(pull: z.infer<typeof pullSchema> | undefined): Merge {
  const oid = pull?.mergeCommit?.oid
  return pull?.state === 'MERGED' && oid !== undefined && FULL_SHA.test(oid) ? { kind: 'merged', sha: oid } : { kind: 'none' }
}

/**
 * Answers kept by key: an answer that is final stays for good, any other for RETRY_MS. An expired answer is still given
 * while it is asked again, so a line does not blink. One ask per key at a time; `onAnswer` is called after each.
 */
class Kept<T> {
  private readonly answers = new Map<string, { value: T; until: number }>()
  private readonly asking = new Set<string>()

  constructor(
    private readonly now: () => number,
    private readonly onAnswer: () => void,
  ) {}

  /** The answer for `key`, or undefined before the first; asks with `ask` (which never rejects) when there is none or it expired. */
  get(key: string, ask: () => Promise<{ value: T; final: boolean }>): T | undefined {
    const kept = this.answers.get(key)
    if ((kept === undefined || kept.until <= this.now()) && !this.asking.has(key)) {
      this.asking.add(key)
      void ask().then(
        ({ value, final }) => {
          this.answers.set(key, { value, until: final ? Infinity : this.now() + RETRY_MS })
          this.asking.delete(key)
          this.onAnswer()
        },
        // Not expected (the asks catch their own failures); the key is asked again next time rather than never.
        () => this.asking.delete(key),
      )
    }
    return kept?.value
  }
}

export class StableLine {
  private readonly git: GitRunner
  private readonly merges: Kept<Merge>
  private readonly ancestry: Kept<Ancestry>
  private readonly builds: Kept<Build>

  constructor(
    private readonly sources: StableLineSources,
    onChange: () => void,
  ) {
    const now = sources.now ?? Date.now
    this.git = sources.git ?? gitRunner
    this.merges = new Kept(now, onChange)
    this.ancestry = new Kept(now, onChange)
    this.builds = new Kept(now, onChange)
  }

  /** The line of `ticket` now; null while an answer it needs has not come yet (`onChange` is called when it does). */
  line(project: StableProject, ticket: Ticket): AcceptanceStable | null {
    if (!isWorfyRepo(project.repoUrl)) return mergedLine(ticket)
    const stable = (this.sources.stableCommit ?? stableCopyCommit)()
    if (stable === null || !SHA.test(stable)) return notChecked('no Stable copy found')
    const { root } = project
    let pending = false
    const shas: string[] = []
    for (const ref of refsOf(ticket, project.tickets)) {
      const merge = this.merges.get(`${root}\n${refKey(ref)}`, () => this.askMerge(root, ref))
      if (merge === undefined) pending = true
      else if (merge.kind === 'failed') return notChecked('GitHub did not answer')
      else if (merge.kind === 'merged') shas.push(merge.sha)
    }
    if (pending) return null
    if (shas.length === 0) return notChecked('no merged PR found')
    const facts = shas.map((sha) => ({
      sha,
      ancestry: this.ancestry.get(`${root}\n${sha}\n${stable}`, () => this.askAncestry(root, sha, stable)),
      build: this.builds.get(`${root}\n${sha}`, () => this.askBuild(root, sha)),
    }))
    const running = this.builds.get(`${root}\n${stable}`, () => this.askBuild(root, stable))
    if (running === undefined || facts.some((fact) => fact.ancestry === undefined || fact.build === undefined)) return null
    if (facts.some((fact) => fact.ancestry === 'missing-stable')) return notChecked(`its commit ${short(stable)} is not in this checkout`)
    const missing = facts.find((fact) => fact.ancestry === 'missing-merge')
    if (missing !== undefined) return notChecked(`the merge commit ${short(missing.sha)} is not in this checkout`)
    if (facts.some((fact) => fact.ancestry === 'failed')) return notChecked('git did not answer')
    // The first build with the whole change: the one of its latest merge.
    const since = facts.map((fact) => fact.build!).reduce((a, b) => ((b.number ?? -1) > (a.number ?? -1) ? b : a))
    if (facts.every((fact) => fact.ancestry === 'in')) return lineOf('in', `In your Stable copy ${running.label} — the change is there since ${since.label}`)
    const update = this.updateFor(root, shas, since)
    if (update === undefined) return null
    return lineOf('out', `Not in your Stable copy yet: it runs ${running.label}, the change is in ${since.label}`, update)
  }

  /**
   * What Update first offers: Update worfy when the Available update has every merge — by the build numbers when both
   * are known, else by git, and only when git says so; `main` waits for a green CI otherwise; not known when git does not
   * have a commit to compare; nothing to offer in a copy that does not check for updates. undefined while git has not
   * answered.
   */
  private updateFor(root: string, shas: readonly string[], since: Build): NonNullable<AcceptanceStable['update']> | undefined {
    const { checks, available } = this.sources.update?.() ?? { checks: false, available: null }
    if (!checks) return 'no-update-check'
    if (available === null) return 'waits-ci'
    if (available.number !== undefined && since.number !== null) return available.number >= since.number ? 'available' : 'waits-ci'
    if (!SHA.test(available.sha)) return 'waits-ci'
    const answers = shas.map((sha) => this.ancestry.get(`${root}\n${sha}\n${available.sha}`, () => this.askAncestry(root, sha, available.sha)))
    if (answers.some((answer) => answer === undefined)) return undefined
    // A commit git does not have (worfy never fetches): whether the update has the change is not known here.
    if (answers.some((answer) => answer !== 'in' && answer !== 'out')) return 'update-not-here'
    return answers.every((answer) => answer === 'in') ? 'available' : 'waits-ci'
  }

  private async askMerge(root: string, ref: MergeRef): Promise<{ value: Merge; final: boolean }> {
    try {
      let merge: Merge
      if (ref.kind === 'pr') {
        merge = mergeOf(pullSchema.parse(JSON.parse(await this.sources.gh(root, ['pr', 'view', String(ref.pr), '--json', 'number,state,mergeCommit']))))
      } else if (BRANCH.test(ref.branch) && !ref.branch.includes('..')) {
        const args = ['pr', 'list', '--head', ref.branch, '--state', 'merged', '--json', 'number,state,mergeCommit', '--limit', '1']
        merge = mergeOf(z.array(pullSchema).parse(JSON.parse(await this.sources.gh(root, args)))[0])
      } else {
        merge = { kind: 'none' }
      }
      return { value: merge, final: merge.kind === 'merged' }
    } catch {
      return { value: { kind: 'failed' }, final: false }
    }
  }

  private async askAncestry(root: string, merge: string, stable: string): Promise<{ value: Ancestry; final: boolean }> {
    if (merge === stable) return { value: 'in', final: true }
    const { code } = await this.git(root, ['merge-base', '--is-ancestor', merge, stable])
    if (code === 0 || code === 1) return { value: code === 0 ? 'in' : 'out', final: true }
    const has = async (sha: string): Promise<boolean> => (await this.git(root, ['cat-file', '-e', `${sha}^{commit}`])).code === 0
    if (!(await has(stable))) return { value: 'missing-stable', final: false }
    if (!(await has(merge))) return { value: 'missing-merge', final: false }
    return { value: 'failed', final: false }
  }

  private async askBuild(root: string, sha: string): Promise<{ value: Build; final: boolean }> {
    const [shallow, count, file] = await Promise.all([
      this.git(root, ['rev-parse', '--is-shallow-repository']),
      this.git(root, ['rev-list', '--count', sha]),
      this.git(root, ['show', `${sha}:package.json`]),
    ])
    // A shallow clone (`--depth`) counts only the commits it has: its number would be made up, so there is none.
    const whole = shallow.code === 0 && shallow.stdout.trim() === 'false'
    const number = whole && count.code === 0 ? Number(count.stdout.trim()) : NaN
    let version: string | null
    try {
      version = file.code === 0 ? packageSchema.parse(JSON.parse(file.stdout)).version : null
    } catch {
      version = null
    }
    if (!Number.isSafeInteger(number) || number < 1 || version === null) return { value: { label: short(sha), number: null }, final: false }
    const label = numberedVersion(`${version}+${short(sha)}`, number)
    return { value: { label, number }, final: true }
  }
}
