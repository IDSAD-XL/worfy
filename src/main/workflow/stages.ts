// The Stage of every Ticket of a Project, kept current in main (ADR-0067). The facts come from
// what worfy already reads, and nothing is written anywhere (ADR-0002, ADR-0005):
// - the workflow model (src/main/workflow/watch.ts): Status, its time, `Blocked reason:`, `Waits:`;
// - the PR tracker (src/main/github/prs.ts): the PR of the Ticket's branch, its head SHA, CI checks,
//   `reviewDecision`, merge commit and time, and in Full mode the agents' marks among its commit statuses;
//   not asked for a Full mode repository whose marks are in the marks file (it has no GitHub);
// - the marks file of the Ticket (src/main/workflow/marks.ts) where `marksInFile` says so: in Silent
//   mode, and in Full mode with `workflow.finish` `local-green` in a repository without `origin`;
// - git: the heads of the branches (`for-each-ref`; in a Project over several repositories ticketBranches, by the
//   pair (repo, branch)) and, for a Ticket on Deploy, whether its merge commit is in a deployed commit
//   (`merge-base --is-ancestor`);
// - the Deployments and deploy marks (src/main/github/deployments.ts), only for Tickets on Deploy;
// - the e2e lock of the Profile (`workflow.e2e_lock`): whether its folder is there, and its holder.json;
// - the releases a Ticket's `Release:` lines wait for (src/main/workflow/release.ts), only when the Pipeline has the
//   Stage `release` (ADR-0104, items 5, 6).
// The Stages are computed again on every change of the workflow model and on every tick of the PR
// interval (the tracker runs gh only when its interval has passed); subscribers get the whole snapshot
// when anything in it changed. Only Tickets in work (`claimed`, `blocked`) get PR, git and marks facts:
// an open Ticket is Queued and a done one Done whatever else is true. A Ticket over several repositories (ADR-0104)
// gets these facts in each repository its `Repo:` lines name, and stageOf puts it on the earliest of their Stages.
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { PipelineColumn, PipelineSnapshot, PipelineTicket } from '../../shared/ipc/pipeline'
import { pullOfTicket } from '../../shared/ipc/checks'
import { DEFAULT_PIPELINE, stageId, stageLabel, stageOf, type DeployFact, type MarkFact, type PipelineStage, type ReleaseFact, type RepoStageFacts, type StageFacts } from '../../shared/workflow/pipeline'
import { repoFactsOf, type Ticket, type TicketRelease, type WorkflowModel } from '../../shared/workflow/types'
import { repoOfPullUrl, type DeploymentReader, type Deployed } from '../github/deployments'
import type { PrRead, TrackedPull } from '../github/prs'
import type { PathRules } from '../remote-links'
import { marksFromStatuses, SilentMarks } from './marks'
import type { PipelineProfile } from './profile'
import { isTopLevel, ticketBranches } from './reader'
import type { ReleaseReader } from './release'
import type { WorkflowSubscriber } from './watch'

const run = promisify(execFile)

/** Variables that would point git at another repository than the one `-C` names. */
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']

/** Runs a read-only git command in `cwd`: its exit code and stdout; a git that cannot start is code null. */
export type GitRunner = (cwd: string, args: readonly string[]) => Promise<{ code: number | null; stdout: string }>

export const gitRunner: GitRunner = async (cwd, args) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_LOCATION_VARS.includes(name)))
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { env, timeout: 10_000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    return { code: 0, stdout }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    return { code: typeof code === 'number' ? code : null, stdout: '' }
  }
}

export interface StageSources {
  /** The workflow hub: the model, and its changes as a subscriber. */
  workflow: {
    open(root: string, subscriber: WorkflowSubscriber): Promise<WorkflowModel>
    close(root: string, subscriberId: number | string): Promise<boolean>
    model(root: string): Promise<WorkflowModel | null>
  }
  /** The app's one PR tracker (sharedPrTracker). */
  prs: { read(root: string, branches: readonly string[]): Promise<PrRead> }
  /** The Profile's Pipeline, mode, name and lock (readPipelineProfile), or why there is none. */
  profile: (root: string) => Promise<{ ok: true; profile: PipelineProfile } | { ok: false; reason: string }>
  deployments: Pick<DeploymentReader, 'environment' | 'deployMarks'>
  /** The tags and published versions of the `Release:` lines (ReleaseReader); without it every line is not checked. */
  release?: Pick<ReleaseReader, 'check'>
  /** The Harness home: its `runs/<project>/marks/` keeps the marks files (marksInFile). */
  harnessHome: string
  git?: GitRunner
  /** How often the PRs are asked again; the tracker's own interval (60 s) by default. */
  intervalMs?: number
  log?: (message: string) => void
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: Pick<PathRules, 'resolve'>
}

/** Something that receives `pipeline.changed`: a client of the app. */
export interface StageSubscriber {
  readonly id: number | string
  send(snapshot: PipelineSnapshot): void
}

/** The branch a Ticket is worked in: its `Branch:` line, else `<epic>/<NN>`. */
export const branchOfTicket = (ticket: Pick<Ticket, 'epic' | 'num' | 'branch'>): string => ticket.branch ?? `${ticket.epic}/${String(ticket.num).padStart(2, '0')}`

const inWork = (ticket: Ticket): boolean => ticket.state === 'work' || ticket.state === 'blocked'

const holderSchema = z.object({ prs: z.array(z.number().int().positive()) }).loose()

/** The e2e lock: null when its folder is not there; `prs` null when holder.json is empty, missing or unreadable. */
export async function readE2eLock(folder: string | null): Promise<StageFacts['lock']> {
  if (folder === null) return null
  try {
    if (!(await stat(folder)).isDirectory()) return null
  } catch {
    return null
  }
  try {
    const holder = holderSchema.safeParse(JSON.parse(await readFile(join(folder, 'holder.json'), 'utf8')))
    return { prs: holder.success ? holder.data.prs : null }
  } catch {
    return { prs: null }
  }
}

/**
 * Whether the agents' marks of a Ticket are in the marks file of the Harness home rather than among
 * the commit statuses of its PR: in Silent mode, and in Full mode when the Profile finishes with green
 * local checks (`workflow.finish` `local-green`) and the Ticket's repository has no `origin`, so there
 * is no repository on GitHub to hold a commit status. The same rule as `harness/bin/ticket mark`,
 * which writes the marks: the two change together. `hasOrigin` is asked only when the answer hangs on it.
 */
export async function marksInFile(profile: Pick<PipelineProfile, 'mode' | 'finish'>, hasOrigin: () => Promise<boolean>): Promise<boolean> {
  if (profile.mode === 'silent') return true
  return profile.finish === 'local-green' && !(await hasOrigin())
}

/** How many branches that could not be read the problems name one by one; the rest are counted. */
export const BRANCH_ERRORS_SHOWN = 3

const columnsOf = (pipeline: readonly PipelineStage[]): PipelineColumn[] => pipeline.map((stage) => ({ ...stage, id: stageId(stage), title: stageLabel(stage) }))

/** Computes one snapshot of a Project; keeps what is worth keeping between snapshots. */
export class StageReader {
  private readonly git: GitRunner
  private readonly ancestry = new Map<string, boolean>()
  private marks: SilentMarks | null = null
  private marksKey = ''

  constructor(private readonly sources: StageSources) {
    this.git = sources.git ?? gitRunner
  }

  async read(root: string, model: WorkflowModel | null): Promise<PipelineSnapshot> {
    const problems: string[] = []
    const profileRead = await this.sources.profile(root)
    let profile: PipelineProfile
    if (profileRead.ok) profile = profileRead.profile
    else {
      problems.push(`the Profile could not be read, the default Pipeline stands in: ${profileRead.reason}`)
      profile = { name: '', mode: 'full', finish: null, pipeline: DEFAULT_PIPELINE, pipelineReason: null, e2eLock: null, repos: [] }
    }
    if (profile.pipelineReason !== null) problems.push(`the default Pipeline stands in: ${profile.pipelineReason}`)
    if (model?.error) problems.push(`the workflow model is empty: ${model.error.message}`)
    // Worktree branches whose `epic-status --ref` failed (the reader); not the gh look-ups of PRs below.
    const unreadBranches = model?.branchErrors ?? []
    for (const { branch, message } of unreadBranches.slice(0, BRANCH_ERRORS_SHOWN)) {
      problems.push(`the worktree branch ${branch} could not be read, the status of its Ticket may be behind it (an open Ticket goes into no Wave): ${message}`)
    }
    if (unreadBranches.length > BRANCH_ERRORS_SHOWN) problems.push(`${unreadBranches.length - BRANCH_ERRORS_SHOWN} more worktree branches could not be read`)
    const pipeline = profile.pipeline
    const tickets = model?.tickets ?? []

    // Which repositories each Ticket in work is checked in: the root, or in a Project over several the repositories
    // of its `Repo:` lines (a Ticket over several repositories names more than one, ADR-0104). The root only when
    // it is inside a git work tree: a Profile that could not be read names no repositories, and the root of a
    // Project over several (a multi-repo one) is a plain folder — gh and git never run there.
    const several = profile.repos.length > 1
    const rootRepo = !several && tickets.some(inWork) && (await this.isInWorkTree(root)) ? root : null
    const pathOf = (name: string | null | undefined): string | null => profile.repos.find((repo) => repo.name === name)?.path ?? null
    const reposOf = (ticket: Ticket): { name: string; path: string | null }[] => {
      if (!several) return [{ name: '', path: rootRepo }]
      const names = repoFactsOf(ticket).repos
      return names.length > 1 ? names.map((name) => ({ name, path: pathOf(name) })) : [{ name: ticket.repo ?? '', path: pathOf(ticket.repo) }]
    }
    const byRepo = new Map<string, Ticket[]>()
    for (const ticket of tickets.filter(inWork)) {
      for (const { path } of reposOf(ticket)) if (path !== null) byRepo.set(path, [...(byRepo.get(path) ?? []), ticket])
    }

    const lock = await readE2eLock(profile.e2eLock)
    if (profile.name !== '' && this.marksKey !== profile.name) {
      this.marks = new SilentMarks({ harnessHome: this.sources.harnessHome, project: profile.name, log: this.sources.log })
      this.marksKey = profile.name
    }

    const pulls = new Map<string, TrackedPull[]>()
    const fileMarks = new Set<string>()
    for (const [repo, own] of byRepo) {
      const inFile = await marksInFile(profile, () => this.hasOrigin(repo))
      if (inFile) fileMarks.add(repo)
      // A Full mode repository with its marks in the file has no GitHub: its PR facts stay empty and gh is not run for it.
      if (inFile && profile.mode === 'full') pulls.set(repo, [])
      // A folder of a Project over several repositories inside another repository: gh would give that one's PRs as its own.
      else if (several && !(await this.isTopLevel(repo))) {
        problems.push(`${repo} is not the top level of its repository, its PRs are not read`)
        pulls.set(repo, [])
      }
      else {
        const read = await this.sources.prs.read(repo, [...new Set(own.map(branchOfTicket))])
        if (!read.gh.available) problems.push(`gh is unavailable in ${repo}: ${read.gh.error ?? 'no reason given'}`)
        // gh answered the list: only the Tickets of these branches may miss their PR (worfy-polish ticket 68).
        for (const failed of read.branchErrors ?? []) problems.push(`gh could not look up the PR of branch ${failed.branch} in ${repo}: ${failed.error}`)
        pulls.set(repo, read.pulls)
      }
    }
    const releaseStage = pipeline.some((stage) => stage.kind === 'release')
    const heads = several ? await this.ticketHeads(profile.repos.filter((repo) => byRepo.has(repo.path)), tickets.filter(inWork)) : new Map<string, Map<string, string>>()
    if (!several) for (const repo of byRepo.keys()) heads.set(repo, await this.branchHeads(repo))

    const entries: PipelineTicket[] = []
    for (const ticket of tickets) {
      const facts: StageFacts = {
        mode: profile.mode,
        status: ticket.state,
        statusAt: ticket.statusAt ?? null,
        blockedReason: ticket.blockedReason ?? null,
        waits: ticket.waits ?? null,
        headSha: null,
        pr: null,
        marks: [],
        deploys: [],
        lock,
      }
      // The facts of each repository of the Ticket; a repository the Profile does not have gives none.
      const where = inWork(ticket) ? reposOf(ticket) : []
      const read: { name: string; path: string | null; pull: TrackedPull | null; facts: RepoStageFacts }[] = []
      for (const { name, path } of where) {
        const pull = path === null ? null : this.pullOf(pulls.get(path) ?? [], ticket)
        const open = pull?.state === 'OPEN' ? pull : null
        read.push({
          name,
          path,
          pull,
          facts: {
            repo: name,
            headSha: path === null ? null : (open?.headSha ?? heads.get(path)?.get(branchOfTicket(ticket)) ?? null),
            pr: pull === null ? null : { number: pull.number, state: pull.state, headSha: pull.headSha, checks: pull.checks, reviewDecision: pull.reviewDecision, mergedAt: pull.mergedAt, mergeCommit: pull.mergeCommit },
            marks: path === null ? [] : await this.marksOf(fileMarks.has(path), ticket, open),
            deploys: [],
          },
        })
      }
      // A Ticket over several repositories gets the facts of each; one of a single repository keeps them as before.
      if (read.length > 1) facts.repos = read.map((each) => each.facts)
      else if (read[0] !== undefined && read[0].path !== null) Object.assign(facts, { headSha: read[0].facts.headSha, pr: read[0].facts.pr, marks: read[0].facts.marks })
      const lines = releaseStage && inWork(ticket) ? repoFactsOf(ticket).releases : []
      if (lines.length > 0) facts.releases = await this.releasesOf(lines, where, pathOf, problems)
      let stage = stageOf(facts, pipeline)
      const deploy = pipeline[stage.index]
      if (deploy?.kind === 'deploy') {
        let found = false
        for (const each of read) {
          if (each.path === null || each.pull === null) continue
          each.facts.deploys = await this.deploysOf(each.path, each.pull, deploy, profile.mode)
          found = true
        }
        if (found) {
          if (facts.repos === undefined) facts.deploys = read[0]!.facts.deploys
          stage = stageOf(facts, pipeline)
        }
      }
      entries.push({ epic: ticket.epic, num: ticket.num, ...stage })
    }

    return { root, pipeline: columnsOf(pipeline), tickets: entries, error: problems.length > 0 ? problems.join('; ') : null }
  }

  /**
   * What is known of each `Release:` line: a tag is asked about in the checkout of the library's repository, a package
   * in the checkout of the first repository of the Ticket that is not the library's (a consumer). A line not checked
   * puts its reason among the problems of the snapshot.
   */
  private async releasesOf(lines: readonly TicketRelease[], where: readonly { name: string; path: string | null }[], pathOf: (name: string) => string | null, problems: string[]): Promise<ReleaseFact[]> {
    const facts: ReleaseFact[] = []
    for (const line of lines) {
      const places = { library: pathOf(line.repo), consumer: where.find((each) => each.name !== line.repo && each.path !== null)?.path ?? null }
      const seen = this.sources.release === undefined ? { state: 'not checked' as const, reason: 'worfy has no release reader here' } : await this.sources.release.check(line, places)
      if (seen.state === 'not checked') problems.push(`the release ${line.ref} of ${line.repo} was not checked: ${seen.reason ?? 'no reason given'}`)
      facts.push({ repo: line.repo, kind: line.kind, ref: line.ref, state: seen.state })
    }
    return facts
  }

  /** The PR of a Ticket's branch: an open one first, then a merged one, newest first (pullOfTicket). */
  private pullOf(pulls: readonly TrackedPull[], ticket: Ticket): TrackedPull | null {
    const found = pullOfTicket({ root: '', worktrees: [], pulls: [...pulls], gh: { available: true, error: null, intervalMs: 1 } }, ticket)
    return found === null ? null : (pulls.find((pull) => pull.number === found.number) ?? null)
  }

  private async marksOf(inFile: boolean, ticket: Ticket, open: TrackedPull | null): Promise<MarkFact[]> {
    if (inFile) return this.marks === null ? [] : this.marks.read(ticket.epic, ticket.num)
    return open === null ? [] : marksFromStatuses(open.markStatuses, open.headSha)
  }

  /** Whether `folder` is in a git work tree, as gh needs to find the repository of its PRs. */
  private async isInWorkTree(folder: string): Promise<boolean> {
    const inside = await this.git(folder, ['rev-parse', '--is-inside-work-tree'])
    return inside.code === 0 && inside.stdout.trim() === 'true'
  }

  /** Whether `folder` is the top level of its own repository (isTopLevel of the reader). */
  private async isTopLevel(folder: string): Promise<boolean> {
    return isTopLevel(folder, async (cwd, args) => {
      const result = await this.git(cwd, args)
      if (result.code !== 0) throw new Error(`git ${args[0] ?? ''} exited with ${String(result.code)}`)
      return result.stdout
    })
  }

  /** Whether the repository has a remote `origin`, as `bin/ticket mark` asks (`git remote get-url origin`). */
  private async hasOrigin(repo: string): Promise<boolean> {
    return (await this.git(repo, ['remote', 'get-url', 'origin'])).code === 0
  }

  /**
   * Checkout → branch name → head SHA of the Tickets' branches in a Project over several repositories: ticketBranches,
   * by the pair (repo, branch), only in a folder that is its own repository's top level.
   */
  private async ticketHeads(checkouts: readonly { name: string; path: string }[], tickets: readonly Ticket[]): Promise<Map<string, Map<string, string>>> {
    const run = async (cwd: string, args: readonly string[]): Promise<string> => {
      const result = await this.git(cwd, args)
      if (result.code !== 0) throw new Error(`git ${args[0] ?? ''} exited with ${String(result.code)}`)
      return result.stdout
    }
    const heads = new Map<string, Map<string, string>>()
    for (const found of await ticketBranches(checkouts, tickets, run)) {
      const own = heads.get(found.path) ?? new Map<string, string>()
      own.set(found.branch, found.head)
      heads.set(found.path, own)
    }
    return heads
  }

  /** Branch name → head SHA of the repository's local branches. */
  private async branchHeads(repo: string): Promise<Map<string, string>> {
    const listed = await this.git(repo, ['for-each-ref', '--format=%(refname:lstrip=2)%09%(objectname)', 'refs/heads'])
    const heads = new Map<string, string>()
    if (listed.code !== 0) return heads
    for (const line of listed.stdout.split('\n')) {
      const [branch, sha] = line.split('\t')
      if (branch && sha) heads.set(branch, sha.trim())
    }
    return heads
  }

  /** The deployed commits that count for this Deploy Stage, each with whether it contains the merge commit. */
  private async deploysOf(repo: string, pull: TrackedPull, stage: PipelineStage, mode: 'full' | 'silent'): Promise<DeployFact[]> {
    const github = repoOfPullUrl(pull.url)
    const merge = pull.mergeCommit
    if (github === null || merge === null) return []
    const environment = stage.environment ?? null
    let deployed: Deployed[]
    if (environment !== null) deployed = await this.sources.deployments.environment(repo, github, environment)
    else if (mode === 'full') deployed = await this.sources.deployments.deployMarks(repo, github)
    else return []
    const facts: DeployFact[] = []
    for (const each of deployed) facts.push({ sha: each.sha, at: each.at, environment, containsMerge: await this.isAncestor(repo, merge, each.sha) })
    return facts
  }

  /**
   * `git merge-base --is-ancestor`: exit 0 yes, 1 no, kept for good; anything else (a commit this
   * clone has not fetched) is no for now and asked again next time.
   * shortcut: worfy never fetches, so a deployed commit missing from the local clone keeps Deploy waiting; ask GitHub's compare API when Tickets stay on Deploy for that reason.
   */
  private async isAncestor(repo: string, ancestor: string, descendant: string): Promise<boolean> {
    if (ancestor === descendant) return true
    const key = `${repo}\n${ancestor}\n${descendant}`
    const known = this.ancestry.get(key)
    if (known !== undefined) return known
    const result = await this.git(repo, ['merge-base', '--is-ancestor', ancestor, descendant])
    if (result.code === 0 || result.code === 1) this.ancestry.set(key, result.code === 0)
    return result.code === 0
  }
}

/** The Stages of one Project, for every subscriber of it. */
class ProjectStages {
  readonly subscribers = new Map<number | string, StageSubscriber>()
  current: PipelineSnapshot | null = null
  private readonly reader: StageReader
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null
  private opened: Promise<unknown> | null = null
  private again = false
  private closed = false

  constructor(
    private readonly root: string,
    private readonly sources: StageSources,
    private readonly watchId: string,
  ) {
    this.reader = new StageReader(sources)
  }

  async start(): Promise<void> {
    // The Stages come from the Tickets' fields: an edit of a Ticket's text alone changes none of them.
    this.opened = this.sources.workflow.open(this.root, { id: this.watchId, fieldsOnly: true, send: () => void this.refresh() })
    await this.opened
    await this.refresh()
    if (this.closed) return
    this.timer = setInterval(() => void this.refresh(), this.sources.intervalMs ?? 60_000)
    this.timer.unref?.()
  }

  /** Computes the snapshot again; calls that come while one runs are folded into one more run. */
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.compute()
      } while (this.again && !this.closed)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async compute(): Promise<void> {
    let next: PipelineSnapshot
    try {
      next = await this.reader.read(this.root, await this.sources.workflow.model(this.root))
    } catch (error) {
      // The reader catches what it expects; a throw here is a bug. Keep the last snapshot's Stages.
      console.error('[pipeline] the Stages could not be computed', error)
      return
    }
    if (this.closed) return
    const changed = this.current !== null && JSON.stringify(this.current) !== JSON.stringify(next)
    this.current = next
    if (changed) for (const subscriber of this.subscribers.values()) subscriber.send(next)
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    // A close that comes while the watch is still opening waits for it, so no subscriber is left in the hub.
    await this.opened?.catch(() => undefined)
    await this.sources.workflow.close(this.root, this.watchId)
    await this.running
  }
}

let watchIds = 0

/**
 * One computation per Project root, shared by its subscribers; it watches the workflow model as a
 * subscriber of the workflow hub of its own, and stops when its last subscriber leaves. A root is
 * keyed by path.resolve, as the workflow hub keys it: on Windows the Project list keeps git's
 * `C:/…` and a window asks for `C:\…`, and both are one computation.
 */
export class StageHub {
  private readonly projects = new Map<string, { stages: ProjectStages; ready: Promise<void> }>()

  constructor(private readonly sources: StageSources) {}

  /** Starts computing `root` for `subscriber` (once per subscriber) and returns the current snapshot. */
  async open(asked: string, subscriber: StageSubscriber): Promise<PipelineSnapshot> {
    const root = this.keyOf(asked)
    let project = this.projects.get(root)
    if (!project) {
      watchIds += 1
      const stages = new ProjectStages(root, this.sources, `pipeline-stages:${watchIds}`)
      const ready = stages.start()
      project = { stages, ready }
      this.projects.set(root, project)
      ready.catch(() => {
        if (this.projects.get(root)?.stages === stages) this.projects.delete(root)
        void stages.close().catch(() => undefined)
      })
    }
    project.stages.subscribers.set(subscriber.id, subscriber)
    await project.ready
    const current = project.stages.current
    if (current === null) throw new Error(`the Stages of ${root} could not be computed`)
    return current
  }

  /** Stops `subscriber`'s interest in `root`; returns false when it was not subscribed. */
  async close(asked: string, subscriberId: number | string): Promise<boolean> {
    const root = this.keyOf(asked)
    const project = this.projects.get(root)
    if (!project || !project.stages.subscribers.delete(subscriberId)) return false
    if (project.stages.subscribers.size === 0) {
      this.projects.delete(root)
      await project.ready.catch(() => undefined)
      await project.stages.close()
    }
    return true
  }

  private keyOf(root: string): string {
    return (this.sources.paths ?? nativePath).resolve(root)
  }

  /** Drops a subscriber from every Project, e.g. when its window is gone. */
  async drop(subscriberId: number | string): Promise<void> {
    await Promise.all([...this.projects.keys()].map((root) => this.close(root, subscriberId)))
  }

  /** The roots being computed; for tests. */
  get roots(): string[] {
    return [...this.projects.keys()]
  }

  async closeAll(): Promise<void> {
    const projects = [...this.projects.values()]
    this.projects.clear()
    await Promise.all(projects.map(async (project) => project.stages.close()))
  }
}
