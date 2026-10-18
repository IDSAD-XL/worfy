// The Stage of every Ticket of a Project, kept current in main (ADR-0067). The facts come from
// what worfy already reads, and nothing is written anywhere (ADR-0002, ADR-0005):
// - the workflow model (src/main/workflow/watch.ts): Status, its time, `Blocked reason:`, `Waits:`;
// - the PR tracker (src/main/github/prs.ts): the PR of the Ticket's branch, its head SHA, CI checks,
//   `reviewDecision`, merge commit and time, and in Full mode the agents' marks among its commit statuses;
// - in Silent mode the marks file of the Ticket (src/main/workflow/marks.ts);
// - git: the heads of the branches (`for-each-ref`) and, for a Ticket on Deploy, whether its merge
//   commit is in a deployed commit (`merge-base --is-ancestor`);
// - the Deployments and deploy marks (src/main/github/deployments.ts), only for Tickets on Deploy;
// - the e2e lock of the Profile (`workflow.e2e_lock`): whether its folder is there, and its holder.json.
// The Stages are computed again on every change of the workflow model and on every tick of the PR
// interval (the tracker runs gh only when its interval has passed); subscribers get the whole snapshot
// when anything in it changed. Only Tickets in work (`claimed`, `blocked`) get PR, git and marks facts:
// an open Ticket is Queued and a done one Done whatever else is true.
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { PipelineColumn, PipelineSnapshot, PipelineTicket } from '../../shared/ipc/pipeline'
import { pullOfTicket } from '../../shared/ipc/checks'
import { DEFAULT_PIPELINE, stageId, stageLabel, stageOf, type DeployFact, type MarkFact, type PipelineStage, type StageFacts } from '../../shared/workflow/pipeline'
import type { Ticket, WorkflowModel } from '../../shared/workflow/types'
import { repoOfPullUrl, type DeploymentReader, type Deployed } from '../github/deployments'
import type { PrRead, TrackedPull } from '../github/prs'
import { marksFromStatuses, SilentMarks } from './marks'
import type { PipelineProfile } from './profile'
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
  /** The Harness home: its `runs/<project>/marks/` keeps the Silent mode marks. */
  harnessHome: string
  git?: GitRunner
  /** How often the PRs are asked again; the tracker's own interval (60 s) by default. */
  intervalMs?: number
  log?: (message: string) => void
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
      profile = { name: '', mode: 'full', pipeline: DEFAULT_PIPELINE, pipelineReason: null, e2eLock: null, repos: [] }
    }
    if (profile.pipelineReason !== null) problems.push(`the default Pipeline stands in: ${profile.pipelineReason}`)
    if (model?.error) problems.push(`the workflow model is empty: ${model.error.message}`)
    const pipeline = profile.pipeline
    const tickets = model?.tickets ?? []

    // Which repository each Ticket in work is checked in: the root, or its `Repo:` in a Project over several.
    // The root only when it is inside a git work tree: a Profile that could not be read names no
    // repositories, and the root of a Project over several (Atakama) is a plain folder — gh and git
    // never run there.
    const several = profile.repos.length > 1
    const rootRepo = !several && tickets.some(inWork) && (await this.isInWorkTree(root)) ? root : null
    const repoOf = (ticket: Ticket): string | null => (several ? (profile.repos.find((repo) => repo.name === ticket.repo)?.path ?? null) : rootRepo)
    const byRepo = new Map<string, Ticket[]>()
    for (const ticket of tickets.filter(inWork)) {
      const repo = repoOf(ticket)
      if (repo !== null) byRepo.set(repo, [...(byRepo.get(repo) ?? []), ticket])
    }

    const lock = await readE2eLock(profile.e2eLock)
    if (profile.mode === 'silent' && profile.name !== '' && this.marksKey !== profile.name) {
      this.marks = new SilentMarks({ harnessHome: this.sources.harnessHome, project: profile.name, log: this.sources.log })
      this.marksKey = profile.name
    }

    const pulls = new Map<string, TrackedPull[]>()
    const heads = new Map<string, Map<string, string>>()
    for (const [repo, own] of byRepo) {
      const read = await this.sources.prs.read(repo, [...new Set(own.map(branchOfTicket))])
      if (!read.gh.available) problems.push(`gh is unavailable in ${repo}: ${read.gh.error ?? 'no reason given'}`)
      pulls.set(repo, read.pulls)
      heads.set(repo, await this.branchHeads(repo))
    }

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
      const repo = inWork(ticket) ? repoOf(ticket) : null
      let pull: TrackedPull | null = null
      if (repo !== null) {
        pull = this.pullOf(pulls.get(repo) ?? [], ticket)
        const open = pull?.state === 'OPEN' ? pull : null
        facts.headSha = open?.headSha ?? heads.get(repo)?.get(branchOfTicket(ticket)) ?? null
        facts.pr =
          pull === null
            ? null
            : { number: pull.number, state: pull.state, headSha: pull.headSha, checks: pull.checks, reviewDecision: pull.reviewDecision, mergedAt: pull.mergedAt, mergeCommit: pull.mergeCommit }
        facts.marks = await this.marksOf(profile, ticket, open)
      }
      let stage = stageOf(facts, pipeline)
      const deploy = pipeline[stage.index]
      if (repo !== null && pull !== null && deploy?.kind === 'deploy') {
        facts.deploys = await this.deploysOf(repo, pull, deploy, profile.mode)
        stage = stageOf(facts, pipeline)
      }
      entries.push({ epic: ticket.epic, num: ticket.num, ...stage })
    }

    return { root, pipeline: columnsOf(pipeline), tickets: entries, error: problems.length > 0 ? problems.join('; ') : null }
  }

  /** The PR of a Ticket's branch: an open one first, then a merged one, newest first (pullOfTicket). */
  private pullOf(pulls: readonly TrackedPull[], ticket: Ticket): TrackedPull | null {
    const found = pullOfTicket({ root: '', worktrees: [], pulls: [...pulls], gh: { available: true, error: null, intervalMs: 1 } }, ticket)
    return found === null ? null : (pulls.find((pull) => pull.number === found.number) ?? null)
  }

  private async marksOf(profile: PipelineProfile, ticket: Ticket, open: TrackedPull | null): Promise<MarkFact[]> {
    if (profile.mode === 'silent') return this.marks === null ? [] : this.marks.read(ticket.epic, ticket.num)
    return open === null ? [] : marksFromStatuses(open.markStatuses, open.headSha)
  }

  /** Branch name → head SHA of the repository's local branches. */
  /** Whether `folder` is in a git work tree, as gh needs to find the repository of its PRs. */
  private async isInWorkTree(folder: string): Promise<boolean> {
    const inside = await this.git(folder, ['rev-parse', '--is-inside-work-tree'])
    return inside.code === 0 && inside.stdout.trim() === 'true'
  }

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
    this.opened = this.sources.workflow.open(this.root, { id: this.watchId, send: () => void this.refresh() })
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
 * subscriber of the workflow hub of its own, and stops when its last subscriber leaves.
 */
export class StageHub {
  private readonly projects = new Map<string, { stages: ProjectStages; ready: Promise<void> }>()

  constructor(private readonly sources: StageSources) {}

  /** Starts computing `root` for `subscriber` (once per subscriber) and returns the current snapshot. */
  async open(root: string, subscriber: StageSubscriber): Promise<PipelineSnapshot> {
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
  async close(root: string, subscriberId: number | string): Promise<boolean> {
    const project = this.projects.get(root)
    if (!project || !project.stages.subscribers.delete(subscriberId)) return false
    if (project.stages.subscribers.size === 0) {
      this.projects.delete(root)
      await project.ready.catch(() => undefined)
      await project.stages.close()
    }
    return true
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
