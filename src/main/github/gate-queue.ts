// The cross-machine gate queue as worfy sees it (worfy-windows ticket 17, ADR-0069): the open PRs with
// the label of the Profile's `cross_machine_gate` that wait for the machine with `serve`. Read-only,
// like the PR badges (src/main/github/prs.ts): worfy never comments, merges or edits a label; the
// skill /worfy:gate-queue does that in a Session (ADR-0002).
//
// - The Profile of this Machine (`bin/profile --field cross_machine_gate`, through a ProfileRunner):
//   its role, label and checks section. Exit code 4 (no field), no Harness, a failed or malformed
//   answer — no queue: gh is not called, and the reason goes to the log once per Project until it
//   changes.
// - The PRs: one `gh pr list --state open --label <label>` in the Project's root, with GH_TOKEN of
//   the Project's GitHub account (accountAuth); the global gh account is never switched.
// - Rule 1, the same as harness/skills/gate-queue/SKILL.md, step 2: a labelled PR from a branch of
//   this repository waits while it has no red report strictly newer than its last commit (a tie
//   still waits). A red report is a comment by the Project's GitHub account whose first line starts
//   with `<checks_section> report: red`. A green report ends no wait: a PR still open after one had
//   its merge fail, and the serving machine takes it again. A fork PR never waits. The wait counts
//   from the later of the PR's creation and its last commit.
// - One read per Project per GATE_QUEUE_INTERVAL_MS. When gh fails the interval doubles, up to
//   GATE_QUEUE_MAX_INTERVAL_MS; the first success brings it back.
import { z } from 'zod'
import type { GateQueueGh, GateQueueView } from '../../shared/ipc/gate-queue'
import { readGithubAccount, type ProfileEnv, type ProfileRunner } from '../workflow/profile'
import { accountAuth, type GhRunner } from './prs'

export const GATE_QUEUE_INTERVAL_MS = 5 * 60_000
export const GATE_QUEUE_MAX_INTERVAL_MS = 30 * 60_000
export const GATE_QUEUE_LIMIT = 100
export const GATE_QUEUE_FIELDS = 'number,title,url,createdAt,isCrossRepository,commits,comments'
export const CROSS_MACHINE_GATE_FIELD = 'cross_machine_gate'

export type CrossMachineRole = 'serve' | 'request'

/** This Machine's part of the cross-machine gate, as its Profile says. */
export interface CrossMachineGate {
  role: CrossMachineRole
  label: string
  checksSection: string
}

const gateSchema = z.object({
  role: z.enum(['serve', 'request']),
  // Passed to gh as the value of --label: a value that starts with "-" would be read as an option.
  label: z
    .string()
    .trim()
    .min(1)
    .refine((label) => !label.startsWith('-'), 'starts with "-"'),
  checks_section: z.string().trim().min(1),
})

/** The Profile's cross_machine_gate of the Project at `root`, or null with the reason there is none. */
export async function readCrossMachineGate(profile: ProfileRunner, root: string): Promise<{ gate: CrossMachineGate | null; reason: string | null }> {
  const none = (reason: string) => ({ gate: null, reason })
  let run
  try {
    run = await profile(root, ['-C', root, '--field', CROSS_MACHINE_GATE_FIELD])
  } catch (error) {
    return none(`the profile script could not be run: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (run.code === 4) return none(`the Profile has no ${CROSS_MACHINE_GATE_FIELD} (profile exit code 4): one machine, no queue`)
  if (run.code !== 0) return none(`the profile script failed with exit code ${run.code ?? 'none'}`)
  let json: unknown
  try {
    json = JSON.parse(run.stdout)
  } catch {
    return none(`${CROSS_MACHINE_GATE_FIELD} is not JSON`)
  }
  if (json === null) return none(`${CROSS_MACHINE_GATE_FIELD} is null: one machine, no queue`)
  const parsed = gateSchema.safeParse(json)
  if (!parsed.success) return none(`${CROSS_MACHINE_GATE_FIELD} is malformed: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`)
  return { gate: { role: parsed.data.role, label: parsed.data.label, checksSection: parsed.data.checks_section }, reason: null }
}

// ── rule 1 ───────────────────────────────────────────────────────────────────

/** A labelled PR as `gh pr list --json number,title,url,createdAt,isCrossRepository,commits,comments` gives it. */
export interface QueuePr {
  number: number
  title: string
  url: string
  createdAt: string
  /** A PR from a fork; the skill skips it, so it never waits. */
  isCrossRepository?: boolean | undefined
  commits: readonly { oid?: string | null | undefined; committedDate?: string | null | undefined }[]
  comments: readonly { author?: { login: string } | null | undefined; createdAt: string; body: string }[]
}

/** A PR that waits for the machine with `serve`. */
export interface WaitingPr {
  number: number
  title: string
  url: string
  /** Since when it waits: the later of its creation and its last commit, as gh gave it. */
  since: string
  /** The oid of its last commit (its committedDate when gh gives no oid), null without commits. */
  lastCommit: string | null
  /** How long it has waited at `now`. */
  waitedMs: number
}

/**
 * Rule 1 (harness/skills/gate-queue/SKILL.md, step 2): the PRs of `prs` from a branch of this
 * repository without a red report strictly newer than their last commit, the oldest wait first. Only
 * a comment by `account` counts as a report; with no account no report counts and every PR waits. A
 * green report ends no wait (its merge failed if the PR is still open). A fork PR and a PR whose
 * times cannot be read are left out.
 */
export function waitingPrs(prs: readonly QueuePr[], checksSection: string, account: string | null, now: number): WaitingPr[] {
  const prefix = `${checksSection} report: red`
  const waiting: (WaitingPr & { sinceMs: number })[] = []
  for (const pr of prs) {
    if (pr.isCrossRepository === true) continue
    const last = pr.commits.at(-1)
    const created = Date.parse(pr.createdAt)
    const committed = last?.committedDate == null ? Number.NaN : Date.parse(last.committedDate)
    if (Number.isNaN(created)) continue
    const pushed = Number.isNaN(committed) ? created : committed
    const reports = account === null ? [] : pr.comments.filter((comment) => comment.author?.login === account && comment.body.startsWith(prefix)).map((comment) => Date.parse(comment.createdAt))
    if (reports.some((at) => at > pushed)) continue
    const sinceMs = Math.max(created, pushed)
    const since = sinceMs === created ? pr.createdAt : (last?.committedDate ?? pr.createdAt)
    waiting.push({ number: pr.number, title: pr.title, url: pr.url, since, lastCommit: last?.oid ?? last?.committedDate ?? null, waitedMs: Math.max(0, now - sinceMs), sinceMs })
  }
  return waiting.sort((a, b) => a.sinceMs - b.sinceMs || a.number - b.number).map((pr) => ({ number: pr.number, title: pr.title, url: pr.url, since: pr.since, lastCommit: pr.lastCommit, waitedMs: pr.waitedMs }))
}

const prListSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    title: z.string(),
    url: z.string(),
    createdAt: z.string(),
    isCrossRepository: z
      .boolean()
      .nullish()
      .transform((cross) => cross ?? false),
    commits: z
      .array(z.object({ oid: z.string().nullish(), committedDate: z.string().nullish() }))
      .nullish()
      .transform((commits) => commits ?? []),
    comments: z
      .array(z.object({ author: z.object({ login: z.string() }).nullish(), createdAt: z.string(), body: z.string() }))
      .nullish()
      .transform((comments) => comments ?? []),
  }),
)

// ── the reader ───────────────────────────────────────────────────────────────

/** One read of a Project's queue; the IPC answer (src/shared/ipc/gate-queue.ts) is its view. */
export interface GateQueueRead {
  role: CrossMachineRole | null
  label: string | null
  waiting: WaitingPr[]
  gh: GateQueueGh
}

export interface GateQueueReaderOptions {
  /** Runs `bin/profile` (src/main/workflow/profile.ts, profileRunner). */
  profile: ProfileRunner
  /** Runs gh (src/main/github/prs.ts, ghRunner). */
  run: GhRunner
  /** Claude Code's home: where the profile script is looked for, for its reason. */
  claudeHome: string
  /** The environment of the profile script. */
  env: () => Promise<ProfileEnv>
  now?: () => number
  /** Where the reason a Project has no queue goes; console.warn by default. Once per Project until it changes. */
  log?: (message: string) => void
  baseIntervalMs?: number
  maxIntervalMs?: number
}

interface ProjectQueue {
  readAt: number
  intervalMs: number
  last: GateQueueRead | null
  running: Promise<GateQueueRead> | null
  reason: string | null
}

export class GateQueueReader {
  private readonly projects = new Map<string, ProjectQueue>()
  private readonly now: () => number
  private readonly log: (message: string) => void
  private readonly base: number
  private readonly max: number

  constructor(private readonly options: GateQueueReaderOptions) {
    this.now = options.now ?? Date.now
    this.log = options.log ?? ((message) => console.warn(message))
    this.base = options.baseIntervalMs ?? GATE_QUEUE_INTERVAL_MS
    this.max = options.maxIntervalMs ?? GATE_QUEUE_MAX_INTERVAL_MS
  }

  /** The queue of the Project at `root`: the last read while its interval runs, else a new one. One read at a time per Project. */
  read(root: string): Promise<GateQueueRead> {
    const current = this.stateOf(root)
    if (current.running !== null) return current.running
    if (current.last !== null && this.now() - current.readAt < current.intervalMs) return Promise.resolve(current.last)
    current.running = this.refresh(root, current).finally(() => {
      current.running = null
    })
    return current.running
  }

  /** This Machine's role for the Project at `root`, read from the Profile again; gh is not called. */
  async role(root: string): Promise<CrossMachineRole | null> {
    const { gate, reason } = await readCrossMachineGate(this.options.profile, root)
    this.noteReason(root, reason)
    return gate?.role ?? null
  }

  private stateOf(root: string): ProjectQueue {
    let state = this.projects.get(root)
    if (state === undefined) {
      state = { readAt: -Infinity, intervalMs: this.base, last: null, running: null, reason: null }
      this.projects.set(root, state)
    }
    return state
  }

  private noteReason(root: string, reason: string | null): void {
    const state = this.stateOf(root)
    if (state.reason === reason) return
    state.reason = reason
    if (reason !== null) this.log(`[gate-queue] ${root}: no gate queue, because ${reason}`)
  }

  private async refresh(root: string, state: ProjectQueue): Promise<GateQueueRead> {
    state.readAt = this.now()
    const { gate, reason } = await readCrossMachineGate(this.options.profile, root)
    this.noteReason(root, reason)
    if (gate === null) {
      state.intervalMs = this.base
      state.last = { role: null, label: null, waiting: [], gh: { state: 'skipped', reason: reason ?? 'no cross_machine_gate' } }
      return state.last
    }
    // The Project's account, read once for both the token and rule 1. Its reason is the PR badges' to log.
    const { account } = await readGithubAccount({ root, claudeHome: this.options.claudeHome, env: await this.options.env(), run: this.options.profile, log: () => undefined })
    const auth = accountAuth({ account: () => Promise.resolve(account), run: this.options.run })
    try {
      const env = await auth(root)
      const stdout = await this.options.run(['pr', 'list', '--state', 'open', '--label', gate.label, '--limit', String(GATE_QUEUE_LIMIT), '--json', GATE_QUEUE_FIELDS], root, env)
      const prs = prListSchema.parse(JSON.parse(stdout))
      state.intervalMs = this.base
      state.last = { role: gate.role, label: gate.label, waiting: waitingPrs(prs, gate.checksSection, account, this.now()), gh: { state: 'ok' } }
    } catch (error) {
      state.intervalMs = Math.min(state.intervalMs * 2, this.max)
      state.last = { role: gate.role, label: gate.label, waiting: [], gh: { state: 'failed', reason: error instanceof Error ? error.message : String(error) } }
    }
    return state.last
  }
}

/** What the renderer gets: the read, each PR without its commit and wait. */
export function gateQueueView(read: GateQueueRead): GateQueueView {
  return { role: read.role, label: read.label, waiting: read.waiting.map(({ number, title, url, since }) => ({ number, title, url, since })), gh: read.gh }
}
