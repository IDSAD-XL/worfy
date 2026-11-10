// Reads the workflow model of a Project (ADR-0002: worfy reads the workflow, never writes it).
//
// The only reader of the Ticket format is `epic-status --json` of the Harness found on the machine
// (src/main/harness/locate.ts: the plugin's bin/ or `<claude home>/bin`). worfy adds the
// things that script does not carry: the files listed under each Ticket's trail section, the
// Ticket's manual checks and Evidence items of its "done" section (shared/workflow/manual-checks.ts,
// shared/workflow/evidence.ts) — all under the
// headings the Project's Profile names (shared/workflow/doc-headings.ts) — and the Epic's title (the H1 of spec.md), all read from the Tickets root the Harness
// names (src/main/workflow/folder.ts: `<root>/.scratch` in Full mode, the Workflow folder in Silent
// mode). In Full mode a Ticket claimed in a worktree branch is shown with the branch's status:
// `epic-status --json --ref <branch>` reads that branch. A branch never undoes blocked or done of
// the checkout, and its open is its base's (ADR-0033). In Silent mode the status lives in the
// Workflow folder only (ADR-0042): no branch is read. The model also carries the page of the
// Project's repository, from the `origin` remote of its root (`repoUrl`).
//
// Nothing here writes: processes are run with the Project as cwd, files are only read.
import { execFile } from 'node:child_process'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { join, resolve } from 'node:path'
import { accepted, DEFAULT_DOC_HEADINGS, docHeadings, OLD_DOC_HEADINGS, sectionHeadings, type DocHeadings } from '../../shared/workflow/doc-headings'
import { evidenceItems } from '../../shared/workflow/evidence'
import { manualChecks } from '../../shared/workflow/manual-checks'
import { repoPageUrl } from '../github/remote'
import { versionOf } from '../docs/watch'
import { branchNamesTicket, parseTicketBranch } from '../../shared/workflow/ticket-ref'
import { harnessHomes, locateHarness, notFoundPaths, scriptEnv, type HarnessLocation } from '../harness/locate'
import type { HarnessScriptEnv, HarnessScriptEnvSource } from '../harness/script-env'
import { cachedLinks, leadsToRemote, type LinkFs, type PathRules } from '../remote-links'
import { layoutFailure, readProjectLayout, type ProjectLayout } from './folder'
import { harnessScriptCommand, HarnessScriptStartError, NODE_NOT_FOUND, type HarnessScriptCommand } from './profile'
import {
  epicStatusSchema,
  repoFactsOf,
  ticketKey,
  type BranchError,
  type EpicStatusSnapshot,
  type Ticket,
  type WorkflowError,
  type WorkflowModel,
} from '../../shared/workflow/types'

/** Runs `epic-status --json`, or `--json --ref <ref>`, in `cwd` and resolves its stdout. */
export type EpicStatusRunner = (cwd: string, ref: string | null) => Promise<string>

export interface ReaderOptions {
  /** The Project's repository root. */
  root: string
  /** Claude Code's home; the script is that of the Harness found from it (epicStatusPath). */
  claudeHome: string
  /**
   * The environment `epic-status`, `profile` and `ticket` run with: the login shell's
   * (src/main/harness/script-env.ts), never worfy's own, whose PATH from Finder has no node.
   */
  env: HarnessScriptEnvSource
  /** How many branch snapshots run at once (default 4). */
  concurrency?: number
  /** Where the workflow lives; read from the Harness (src/main/workflow/folder.ts) when absent. */
  layout?: ProjectLayout
}

/** A worktree whose branch names a Ticket. */
export interface TicketWorktree {
  path: string
  branch: string
  head: string
}

/** The Status line and the header facts beside it: a branch's status of its Ticket carries all of them. */
type StatusFacts = Pick<Ticket, 'state' | 'statusRaw' | 'statusAt' | 'statusError' | 'blockedReason' | 'waits' | 'pr'>
const statusFacts = (t: StatusFacts): StatusFacts => ({
  state: t.state,
  statusRaw: t.statusRaw,
  statusAt: t.statusAt ?? null,
  statusError: t.statusError ?? null,
  blockedReason: t.blockedReason ?? null,
  waits: t.waits ?? null,
  pr: t.pr ?? null,
})

/** What one branch said about its own Ticket, kept between reads keyed by branch name. */
export interface BranchSnapshot {
  head: string
  /** After a failed read: what the last read that worked said, or null. */
  ticket: (Pick<Ticket, 'epic' | 'num'> & StatusFacts) | null
  error: string | null
  /** Set with `error`: when the branch is read again, and how many reads in a row have failed. */
  retry: { at: number; failures: number } | null
}
export type BranchCache = Map<string, BranchSnapshot>

/**
 * How long a branch whose read failed waits before it is read again, one wait per failure in a
 * row with the last repeated: a passing failure (a timeout under load) clears soon, and a branch
 * that always fails runs `epic-status` once in 5 minutes, not on every read.
 */
export const BRANCH_RETRY_MS: readonly number[] = [30_000, 60_000, 120_000, 300_000]

/** The clock and the waits of `readBranches`; tests replace them. */
export interface BranchReadOptions {
  /** How many branch snapshots run at once (default 4). */
  concurrency?: number
  now?: () => number
  retryMs?: readonly number[]
}

/** The checkout's read before branch statuses are laid over it. */
export type CheckoutModel = Omit<WorkflowModel, 'branchErrors'>

class EpicStatusError extends Error {
  constructor(readonly workflowError: WorkflowError) {
    super(workflowError.message)
  }
}

const MAX_OUTPUT = 64 * 1024 * 1024
const TIMEOUT_MS = 60_000

/**
 * The `epic-status` of the Harness found on the machine (src/main/harness/locate.ts): the plugin's
 * in <harnessHome>/plugin/bin, or the old one in <claudeHome>/bin. The Harness home is
 * WORFY_HARNESS_HOME or <claudeHome>/worfy-harness.
 */
export const epicStatusPath = (claudeHome: string): string => join(locateHarness(harnessHomes(claudeHome)).binDir, 'epic-status')

/**
 * The default runner: the real script as a child process, with a timeout and a size cap. The
 * Harness is looked for on every run, so a machine that switches to the plugin is read without a
 * restart; the plugin's script gets HARNESS_HOME.
 *
 * `env` is asked on every run and is the login shell environment in the app
 * (src/main/harness/script-env.ts). The script is run by the node on that environment's PATH, never
 * by its `#!` line (ADR-0055 item 2): worfy's own PATH from Finder has no node, and Windows reads no
 * `#!` line. Both the first run and the retry run below take the environment asked here, once per call.
 */
export function epicStatusRunner(claudeHome: string, env: HarnessScriptEnvSource): EpicStatusRunner {
  return async (cwd, ref) => {
    const base = await env()
    const harness = locateHarness(harnessHomes(claudeHome))
    try {
      return await runEpicStatus(harness, base, cwd, ref)
    } catch (error) {
      // The Harness changed under the run — the move (ticket 14) took the old scripts away while
      // they ran: one more run, with the Harness found now, instead of an error that would stay
      // on the canvas until the next change in the Project.
      const now = locateHarness(harnessHomes(claudeHome))
      if (now.kind === harness.kind && now.binDir === harness.binDir) throw error
      return runEpicStatus(now, base, cwd, ref)
    }
  }
}

/**
 * One run of `epic-status` of `harness` with the environment `base`; the plugin's gets HARNESS_HOME
 * on top. The script runs as `node <script>`, node from the PATH of that environment, or by itself
 * when it is an older Harness's bash script on macOS or Linux (harnessScriptCommand). A missing
 * script is `not-found` naming where it was looked for, a missing node is `not-found` saying so, an
 * older Harness's script on Windows is `failed` saying to update it; none of them starts a process.
 */
async function runEpicStatus(harness: HarnessLocation, base: HarnessScriptEnv, cwd: string, ref: string | null): Promise<string> {
  const script = join(harness.binDir, 'epic-status')
  const where = harness.kind === 'none' ? notFoundPaths(harness, 'epic-status') : script
  const env = scriptEnv(harness, base)
  const args = ref === null ? ['--json'] : ['--json', '--ref', ref]
  let command: HarnessScriptCommand
  try {
    command = await harnessScriptCommand(script, args, env)
  } catch (error) {
    const code = error instanceof HarnessScriptStartError ? error.code : 'ENOENT'
    if (code === 'NOT_NODE') throw new EpicStatusError({ code: 'failed', message: (error as Error).message })
    const message = code === 'NODE_NOT_FOUND' ? `${NODE_NOT_FOUND}: epic-status is not run (${script})` : `epic-status not found: ${where}`
    throw new EpicStatusError({ code: 'not-found', message })
  }
  return new Promise((resolvePromise, reject) => {
    execFile(command.file, command.args, { cwd, env, maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) return resolvePromise(stdout)
      const code = (error as NodeJS.ErrnoException).code
      // Not started after all: node went away between the look and the start, the folder `cwd` did,
      // or an older Harness's script has no execute bit.
      if (code === 'ENOENT' || code === 'EACCES') {
        return reject(new EpicStatusError({ code: 'not-found', message: `epic-status could not be started: ${error.message}` }))
      }
      const detail = stderr.trim() || error.message
      reject(new EpicStatusError({ code: 'failed', message: `epic-status failed${ref ? ` for ${ref}` : ''}: ${detail}` }))
    })
  })
}

/** Parses the script's stdout with the schema; anything else is an `invalid-output` error. */
export function parseEpicStatus(stdout: string): EpicStatusSnapshot {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    throw new EpicStatusError({ code: 'invalid-output', message: 'epic-status --json printed something that is not JSON' })
  }
  const parsed = epicStatusSchema.safeParse(json)
  if (!parsed.success) {
    throw new EpicStatusError({ code: 'invalid-output', message: `epic-status --json does not match the expected shape: ${parsed.error.issues[0]?.message ?? ''}` })
  }
  return parsed.data
}

const FENCE = /^\s*(```|~~~)/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/

/**
 * The trail section of a Ticket (`heading`, `tickets.trail_section` of the Profile): the backticked
 * text of its list items, in order. `listed` is false when the Ticket has no such section; headings
 * inside code fences don't count.
 */
export function codeSection(markdown: string, heading: string = DEFAULT_DOC_HEADINGS.trailSection): { listed: boolean; files: string[] } {
  const trail = sectionHeadings(accepted(heading, OLD_DOC_HEADINGS.trailSection))
  let inFence = false
  let inSection = false
  let listed = false
  const files: string[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const at = trail.at(line)
    if (at !== null) {
      inSection = at
      if (inSection) listed = true
      continue
    }
    if (!inSection || !LIST_ITEM.test(line)) continue
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const file = match[1]!.trim()
      if (file && !files.includes(file)) files.push(file)
    }
  }
  return { listed, files }
}

/**
 * The H1 of a markdown file, or null: the first line outside ``` and ~~~ fences that is `#`, spaces or tabs, and text,
 * with the trailing spaces and tabs dropped; a byte order mark at the start does not count. It is the rule of the Ticket
 * title in the Harness's epic-status (harness/bin/TICKETS.md, "Header"): both readers are tested on the cases of
 * harness/bin/tests/fixtures/ticket-title.
 */
export function firstHeading(markdown: string): string | null {
  // The run of ` or ~ that opened the code block we are in; '' outside code. A fence closes only with a line of the same
  // character, at least as long, and nothing after it: a ~~~ line inside a ``` block is text of the block. The same rule
  // as harness/lib/code-fence.cjs, which the Harness's ticket and epic-status share.
  let fence = ''
  for (const line of markdown.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const f = /^[ \t]*(`{3,}|~{3,})(.*)$/u.exec(line)
    if (fence !== '') {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && /^[ \t]*$/u.test(f[2]!)) fence = ''
    } else if (f) fence = f[1]!
    else {
      const match = /^#[ \t]+([^ \t].*?)[ \t]*$/u.exec(line)
      if (match) return match[1]!
    }
  }
  return null
}

/** `NN-slug.md` → the key epic-status gives the Ticket: its number and slug (same rules as the script). */
export function issueKey(file: string): string | null {
  if (!file.endsWith('.md')) return null
  const dash = file.indexOf('-')
  const prefix = dash === -1 ? file.slice(0, -3) : file.slice(0, dash)
  if (!/^\d+$/.test(prefix)) return null
  const slug = dash === -1 ? prefix : file.slice(dash + 1, -3)
  return `${Number(prefix)}:${slug}`
}

const readText = (path: string): Promise<string | null> => readFile(path, 'utf8').catch(() => null)

/** What is asked of the file system for the Tickets; both calls follow links. */
export interface TicketFs {
  /** The text of a file, or null when it cannot be read. */
  readText: (path: string) => Promise<string | null>
  /** The names in a folder. */
  readdir: (dir: string) => Promise<string[]>
  /** The real path of the Project root. A stand-in that has none leaves it out. */
  realpath?: (path: string) => Promise<string>
}

const nodeFs: TicketFs = { readText, readdir: (dir) => readdir(dir), realpath: (path) => realpath(path) }

export interface EnrichOptions {
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
  /** lstat and readlink for the links on the way to a file (remote-links.ts); replaced in tests. */
  links?: LinkFs
  /** The calls that follow links; replaced in tests. */
  fs?: TicketFs
  /** The section names the Project's Profile gives (ProjectLayout.headings); the defaults for the rest. */
  headings?: Partial<DocHeadings>
}

/**
 * Adds the trail section files, the manual checks and the Epic titles to a snapshot of the checkout, read from
 * `ticketsRoot` (the folder with `<epic>/spec.md` and `<epic>/issues/`).
 *
 * On Windows readFile and readdir through a link to `\\host\share\…` make the system contact
 * that host with the user's credentials, and a checked-out repository can carry such a link. So
 * the links on the way to each file and folder are read first (remote-links.ts; worfy-windows
 * ticket 19): one that leads there, or cannot be checked, is taken as a file that cannot be read
 * or a folder with nothing in it. The Project root — as written and as its real path — and the
 * Tickets root are the places these paths may go, also when they lie on a share themselves: a
 * link from the Tickets into another folder of the same Project is read as before, and so is a
 * Project whose root is itself a link to a share of the user (worfy-windows ticket 20; readDocs
 * of src/main/docs/watch.ts does the same).
 */
export async function enrichSnapshot(
  root: string,
  snapshot: EpicStatusSnapshot,
  ticketsRoot: string = join(root, '.scratch'),
  options: EnrichOptions = {},
): Promise<CheckoutModel> {
  const scratch = ticketsRoot
  const paths = options.paths ?? nativePath
  const fs = options.fs ?? nodeFs
  // The root is the folder the user opened: its real path is asked for as readDocs asks.
  const real = fs.realpath === undefined ? null : await fs.realpath(root).catch(() => null)
  const allowed = real === null ? [root, scratch] : [root, scratch, real]
  // The walks of this read share their folders: each path is looked at once, and only in this read.
  const links = cachedLinks(options.links)
  const away = (path: string): Promise<boolean> => leadsToRemote(path, allowed, { paths, links })
  const read = async (path: string): Promise<string | null> => ((await away(path)) ? null : fs.readText(path))
  const headings = docHeadings(options.headings)

  const epics = await Promise.all(
    snapshot.epics.map(async (epic) => {
      const spec = epic.hasSpec ? await read(paths.join(scratch, epic.epic, 'spec.md')) : null
      return { ...epic, title: spec === null ? null : firstHeading(spec) }
    }),
  )

  const issueFiles = new Map<string, Map<string, string>>()
  for (const name of new Set(snapshot.tickets.map((ticket) => ticket.epic))) {
    const dir = paths.join(scratch, name, 'issues')
    const entries = (await away(dir)) ? [] : await fs.readdir(dir).catch(() => [] as string[])
    const byKey = new Map<string, string>()
    for (const entry of entries) {
      const key = issueKey(entry)
      if (key) byKey.set(key, paths.join(dir, entry))
    }
    issueFiles.set(name, byKey)
  }

  const tickets = await Promise.all(
    snapshot.tickets.map(async (ticket): Promise<Ticket> => {
      const path = issueFiles.get(ticket.epic)?.get(`${ticket.num}:${ticket.slug}`)
      const markdown = path ? await read(path) : null
      const section = markdown === null ? { listed: false, files: [] } : codeSection(markdown, headings.trailSection)
      const checks = markdown === null ? [] : manualChecks(markdown, headings)
      // From the same text as the manual checks: the file is read once.
      const evidence = markdown === null ? [] : evidenceItems(markdown, headings)
      // The version makes an edit of the text alone a change of the Ticket, so the focused Ticket reads it again.
      const version = markdown === null ? {} : { version: versionOf(markdown) }
      return { ...ticket, files: section.files, filesListed: section.listed, fromBranch: null, manualChecks: checks, evidence, ...version }
    }),
  )

  return { root, epics, tickets, error: null }
}

const errorOf = (error: unknown): WorkflowError =>
  error instanceof EpicStatusError ? error.workflowError : { code: 'failed', message: error instanceof Error ? error.message : String(error) }

/**
 * The model of a Project whose layout could not be read (`layout.failed`): empty, with the reason,
 * as for a failed `epic-status` — the window shows the text and no "No epics yet" panel.
 */
export function failedCheckout(root: string, layout: ProjectLayout): CheckoutModel {
  return { root, epics: [], tickets: [], error: { code: 'failed', message: layoutFailure(layout) } }
}

/**
 * Reads the Project's checkout. A missing or broken script gives an empty model with the reason.
 * `headings` are those of the Project's layout; without them the defaults are read.
 */
export async function readCheckout(root: string, run: EpicStatusRunner, ticketsRoot?: string, headings?: Partial<DocHeadings>): Promise<CheckoutModel> {
  const isDir = await stat(root).then((s) => s.isDirectory()).catch(() => false)
  if (!isDir) return { root, epics: [], tickets: [], error: { code: 'failed', message: `Project folder not found: ${root}` } }
  try {
    const [stdout, repoUrl] = await Promise.all([run(root, null), repoUrlOf(root)])
    return { ...(await enrichSnapshot(root, parseEpicStatus(stdout), ticketsRoot, headings ? { headings } : {})), repoUrl }
  } catch (error) {
    return { root, epics: [], tickets: [], error: errorOf(error) }
  }
}

/** How long the `origin` of a Project root is taken as read: the watcher reads the checkout on every save. */
export const REPO_URL_TTL_MS = 5 * 60_000
const repoUrls = new Map<string, { at: number; url: Promise<string | null> }>()

/**
 * The page of the repository of a Project root: `git remote get-url origin` there through `repoPageUrl`, as the
 * Run history reads it (src/main/flight-recorder/service.ts); null without git, outside a repository, without
 * `origin`, or for an `origin` that is no repository page (a folder). One run of git per root and REPO_URL_TTL_MS:
 * a save of a Ticket file costs no more processes than before, and the first read after that time asks again.
 */
export function repoUrlOf(root: string, now: number = Date.now()): Promise<string | null> {
  const cached = repoUrls.get(root)
  if (cached !== undefined && now - cached.at < REPO_URL_TTL_MS) return cached.url
  const url = git(root, ['remote', 'get-url', 'origin']).then(
    (stdout) => repoPageUrl(stdout.trim()),
    () => null,
  )
  repoUrls.set(root, { at: now, url })
  return url
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS }, (error, stdout) =>
      error ? reject(error) : resolvePromise(stdout),
    )
  })
}

/**
 * Worktrees of the Project whose branch names a Ticket (`git worktree list --porcelain`). The
 * first entry is the checkout itself and is skipped: its state is the checkout's read. Outside
 * git the list is empty.
 */
export async function ticketWorktrees(root: string): Promise<TicketWorktree[]> {
  const output = await git(root, ['worktree', 'list', '--porcelain']).catch(() => '')
  const result: TicketWorktree[] = []
  const blocks = output.split(/\n\n+/).filter((block) => block.trim())
  for (const block of blocks.slice(1)) {
    const field = (name: string) => block.split('\n').find((line) => line.startsWith(`${name} `))?.slice(name.length + 1)
    const path = field('worktree')
    const head = field('HEAD')
    const ref = field('branch')
    if (!path || !head || !ref) continue
    const branch = ref.replace(/^refs\/heads\//, '')
    if (parseTicketBranch(branch)) result.push({ path, branch, head })
  }
  return result
}

/** A branch of a Ticket in one of the repositories it names (ticketBranches). */
export interface RepoTicketBranch {
  /** The repository's name in the Profile (`_resolved.repos`). */
  repo: string
  /** Its checkout. */
  path: string
  branch: string
  head: string
  epic: string
  num: number
}

/**
 * The branches of the Tickets of a Project over several repositories (ADR-0104, item 2). One branch name stands in the
 * checkout of each repository a Ticket names by its `Repo:` lines (repoFactsOf), so a branch is the Ticket's by the
 * pair (repo, branch): branchNamesTicket is asked only of the Tickets that name that repository. Every local branch
 * counts, checked out or not: `parallel: single` works without worktrees. In the order of `checkouts`, then of the
 * branch names; a checkout no Ticket names is not asked, and one outside git gives nothing — nor does a folder that is
 * not the top level of its own repository: git would walk up from it and give a parent repository's branches as this
 * repository's. `run` runs a git command in a folder and rejects when it fails (the stages' runner in main). Only reads.
 */
export async function ticketBranches(
  checkouts: readonly { name: string; path: string }[],
  tickets: readonly Pick<Ticket, 'epic' | 'num' | 'branch' | 'repo' | 'pr' | 'repos' | 'prs' | 'releases'>[],
  run: (cwd: string, args: string[]) => Promise<string> = git,
): Promise<RepoTicketBranch[]> {
  const named = tickets.map((ticket) => ({ ticket, repos: repoFactsOf(ticket).repos }))
  const found = await Promise.all(
    checkouts.map(async ({ name, path }): Promise<RepoTicketBranch[]> => {
      const own = named.filter(({ repos }) => repos.includes(name)).map(({ ticket }) => ticket)
      if (own.length === 0) return []
      if (!(await isTopLevel(path, run))) return []
      const listed = await run(path, ['for-each-ref', '--format=%(refname:lstrip=2)%09%(objectname)', 'refs/heads']).catch(() => '')
      const result: RepoTicketBranch[] = []
      for (const line of listed.split('\n')) {
        const [branch, head] = line.replace(/\r$/u, '').split('\t')
        if (!branch || !head) continue
        const ticket = own.find((each) => branchNamesTicket(branch, each))
        if (ticket) result.push({ repo: name, path, branch, head, epic: ticket.epic, num: ticket.num })
      }
      return result
    }),
  )
  return found.flat()
}

/**
 * Whether `folder` is the top level of a git work tree (`rev-parse --show-toplevel`), compared by their real paths:
 * git gives the real one, with `/` on Windows too. False outside git and when either path does not resolve.
 */
export async function isTopLevel(folder: string, run: (cwd: string, args: string[]) => Promise<string>): Promise<boolean> {
  try {
    const top = (await run(folder, ['rev-parse', '--show-toplevel'])).trim()
    return top !== '' && (await realpath(top)) === (await realpath(folder))
  } catch {
    return false
  }
}

/** Runs `tasks` with at most `limit` in flight. */
async function inPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next
      next += 1
      results[index] = await tasks[index]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/**
 * Brings the branch cache up to date: a branch is read again when its head moved, when it is new,
 * or when its last read failed and the wait after it (BRANCH_RETRY_MS) is over; branches whose
 * worktree is gone, or whose Ticket the checkout does not know, drop out. A failed read keeps what
 * the last read that worked said, so a Ticket claimed in the branch does not fall back to the
 * checkout's open for one timeout.
 */
export async function readBranches(
  root: string,
  checkout: CheckoutModel,
  worktrees: TicketWorktree[],
  previous: BranchCache,
  run: EpicStatusRunner,
  { concurrency = 4, now = Date.now, retryMs = BRANCH_RETRY_MS }: BranchReadOptions = {},
): Promise<BranchCache> {
  const known = new Set(checkout.tickets.map(ticketKey))
  const next: BranchCache = new Map()
  const stale: TicketWorktree[] = []
  const at = now()
  for (const worktree of worktrees) {
    const ref = parseTicketBranch(worktree.branch)!
    if (!known.has(ticketKey(ref)) || next.has(worktree.branch)) continue
    const cached = previous.get(worktree.branch)
    if (cached && cached.head === worktree.head && (cached.retry === null || at < cached.retry.at)) next.set(worktree.branch, cached)
    else stale.push(worktree)
  }

  const fresh = await inPool(
    stale.map((worktree) => async (): Promise<[string, BranchSnapshot]> => {
      const ref = parseTicketBranch(worktree.branch)!
      try {
        const snapshot = parseEpicStatus(await run(root, worktree.branch))
        const own = snapshot.tickets.find((ticket) => ticket.epic === ref.epic && ticket.num === ref.num)
        const ticket = own ? { epic: own.epic, num: own.num, ...statusFacts(own) } : null
        return [worktree.branch, { head: worktree.head, ticket, error: null, retry: null }]
      } catch (error) {
        const before = previous.get(worktree.branch)
        // A new head starts the waits over: the commit may have fixed what failed.
        const failures = (before?.head === worktree.head ? (before.retry?.failures ?? 0) : 0) + 1
        const wait = retryMs[Math.min(failures, retryMs.length) - 1] ?? BRANCH_RETRY_MS[0]!
        return [worktree.branch, { head: worktree.head, ticket: before?.ticket ?? null, error: errorOf(error).message, retry: { at: now() + wait, failures } }]
      }
    }),
    concurrency,
  )
  for (const [branch, snapshot] of fresh) next.set(branch, snapshot)
  return next
}

/**
 * Whether a branch's status of its Ticket goes over the checkout's (ADR-0033). A branch never
 * undoes a decision merged into the checkout — blocked or done there stays — and never says `open`
 * or `none`: that is the status of the branch's base, which a branch that did not touch the
 * Ticket file still carries. So a Ticket claimed in its worktree shows `work`, and a Ticket blocked
 * in the checkout is not shown open because its old worktree branch is still there.
 */
function branchOverrides(checkout: Ticket['state'], branch: Ticket['state']): boolean {
  return checkout !== 'blocked' && checkout !== 'done' && branch !== 'open' && branch !== 'none'
}

/**
 * Lays the branch statuses over the checkout. A branch's Ticket takes the branch's `state`,
 * `statusRaw` and the header facts beside them (a blocked reason, Waits, PR) and gets `fromBranch`
 * when branchOverrides says so and the checkout does not already say the same (the claim was merged).
 */
export function applyBranches(checkout: CheckoutModel, branches: BranchCache): WorkflowModel {
  const overrides = new Map<string, { branch: string; snapshot: BranchSnapshot }>()
  const unread = new Map<string, string>()
  const branchErrors: BranchError[] = []
  for (const [branch, snapshot] of [...branches.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (snapshot.error !== null) {
      branchErrors.push({ branch, message: snapshot.error })
      const ref = parseTicketBranch(branch)
      if (ref) unread.set(ticketKey(ref), branch)
    }
    if (snapshot.ticket) overrides.set(ticketKey(snapshot.ticket), { branch, snapshot })
  }
  const tickets = checkout.tickets.map((ticket) => {
    // A branch that could not be read may hold a claim: the Ticket goes into no Wave until it is read
    // (shared/workflow/waves.ts). Blocked and done in the checkout stand whatever a branch says.
    const unreadBranch = unread.get(ticketKey(ticket))
    const marked = unreadBranch === undefined || ticket.state === 'blocked' || ticket.state === 'done' ? ticket : { ...ticket, unreadBranch }
    const override = overrides.get(ticketKey(ticket))
    const fromBranch = override?.snapshot.ticket
    if (!override || !fromBranch || !branchOverrides(ticket.state, fromBranch.state) || fromBranch.statusRaw === ticket.statusRaw) return marked
    return { ...marked, ...statusFacts(fromBranch), fromBranch: override.branch }
  })
  return { ...checkout, tickets, branchErrors }
}

/** One full read: the checkout, then, in Full mode, every Ticket worktree branch. Never throws. */
export async function readWorkflow(
  options: ReaderOptions,
  run: EpicStatusRunner = epicStatusRunner(options.claudeHome, options.env),
  previous: BranchCache = new Map(),
): Promise<{ model: WorkflowModel; checkout: CheckoutModel; branches: BranchCache }> {
  const root = resolve(options.root)
  const layout = options.layout ?? (await readProjectLayout({ root, claudeHome: options.claudeHome, env: await options.env() }))
  if (layout.failed) {
    // Where the Tickets live is unknown: the reason, not a guess (src/main/workflow/folder.ts).
    const checkout = failedCheckout(root, layout)
    return { model: { ...checkout, branchErrors: [] }, checkout, branches: new Map() }
  }
  const checkout = await readCheckout(root, run, layout.ticketsRoot, layout.headings)
  // Silent mode: no `--ref` (the Harness answers it with exit code 3), no status from branches.
  if (checkout.error || layout.mode === 'silent') return { model: { ...checkout, branchErrors: [] }, checkout, branches: new Map() }
  const branches = await readBranches(root, checkout, await ticketWorktrees(root), previous, run, options.concurrency === undefined ? {} : { concurrency: options.concurrency })
  return { model: applyBranches(checkout, branches), checkout, branches }
}
