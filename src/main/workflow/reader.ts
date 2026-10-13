// Reads the workflow model of a Project (ADR-0002: worfy reads the workflow, never writes it).
//
// The only reader of the Ticket format is `epic-status --json` of the Harness found on the machine
// (src/main/harness/locate.ts: the plugin's bin/ or `<claude home>/bin`). worfy adds the
// two things that script does not carry: the files listed under each Ticket's "Где в коде"
// section and the Epic's title (the H1 of spec.md), both read from the Tickets root the Harness
// names (src/main/workflow/folder.ts: `<root>/.scratch` in Full mode, the Workflow folder in Silent
// mode). In Full mode a Ticket claimed in a worktree branch is shown with the branch's status:
// `epic-status --json --ref <branch>` reads that branch. A branch never undoes blocked or done of
// the checkout, and its open is its base's (ADR-0033). In Silent mode the status lives in the
// Workflow folder only (ADR-0042): no branch is read.
//
// Nothing here writes: processes are run with the Project as cwd, files are only read.
import { execFile } from 'node:child_process'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { join, resolve } from 'node:path'
import { parseTicketBranch } from '../../shared/workflow/ticket-ref'
import { harnessHomes, locateHarness, notFoundPaths, scriptEnv, type HarnessLocation } from '../harness/locate'
import { leadsToRemote, type LinkFs, type PathRules } from '../remote-links'
import { readProjectLayout, type ProjectLayout } from './folder'
import {
  epicStatusSchema,
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

/** What one branch said about its own Ticket, kept between reads keyed by branch name. */
export interface BranchSnapshot {
  head: string
  ticket: Pick<Ticket, 'epic' | 'num' | 'state' | 'statusRaw'> | null
  error: string | null
}
export type BranchCache = Map<string, BranchSnapshot>

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
 */
export function epicStatusRunner(claudeHome: string): EpicStatusRunner {
  return async (cwd, ref) => {
    const harness = locateHarness(harnessHomes(claudeHome))
    try {
      return await runEpicStatus(harness, cwd, ref)
    } catch (error) {
      // The Harness changed under the run — the move (ticket 14) took the old scripts away while
      // they ran: one more run, with the Harness found now, instead of an error that would stay
      // on the canvas until the next change in the Project.
      const now = locateHarness(harnessHomes(claudeHome))
      if (now.kind === harness.kind && now.binDir === harness.binDir) throw error
      return runEpicStatus(now, cwd, ref)
    }
  }
}

/** One run of `epic-status` of `harness`; the plugin's gets HARNESS_HOME. */
function runEpicStatus(harness: HarnessLocation, cwd: string, ref: string | null): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const script = join(harness.binDir, 'epic-status')
    const args = ref === null ? ['--json'] : ['--json', '--ref', ref]
    const env = scriptEnv(harness, process.env)
    execFile(script, args, { cwd, env, maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) return resolvePromise(stdout)
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES') {
        const where = harness.kind === 'none' ? notFoundPaths(harness, 'epic-status') : script
        return reject(new EpicStatusError({ code: 'not-found', message: `epic-status not found: ${where}` }))
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

const CODE_HEADING = /^##\s+Где в коде\s*$/u
const FENCE = /^\s*(```|~~~)/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/

/**
 * The "Где в коде" section of a Ticket: the backticked text of its list items, in order.
 * `listed` is false when the Ticket has no such section; headings inside code fences don't count.
 */
export function codeSection(markdown: string): { listed: boolean; files: string[] } {
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
    if (/^#{1,2}\s/.test(line)) {
      inSection = CODE_HEADING.test(line)
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

/** The H1 of a markdown file, or null. */
export function firstHeading(markdown: string): string | null {
  const match = /^#[ \t]+(.+?)\s*$/mu.exec(markdown)
  return match ? match[1]! : null
}

/** `NN-slug.md` → the key epic-status gives the Ticket: its number and slug (same rules as the script). */
function issueKey(file: string): string | null {
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
}

/**
 * Adds the "Где в коде" files and the Epic titles to a snapshot of the checkout, read from
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
  const away = (path: string): Promise<boolean> => leadsToRemote(path, allowed, { paths, links: options.links })
  const read = async (path: string): Promise<string | null> => ((await away(path)) ? null : fs.readText(path))

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
      const section = markdown === null ? { listed: false, files: [] } : codeSection(markdown)
      return { ...ticket, files: section.files, filesListed: section.listed, fromBranch: null }
    }),
  )

  return { root, epics, tickets, error: null }
}

const errorOf = (error: unknown): WorkflowError =>
  error instanceof EpicStatusError ? error.workflowError : { code: 'failed', message: error instanceof Error ? error.message : String(error) }

/** Reads the Project's checkout. A missing or broken script gives an empty model with the reason. */
export async function readCheckout(root: string, run: EpicStatusRunner, ticketsRoot?: string): Promise<CheckoutModel> {
  const isDir = await stat(root).then((s) => s.isDirectory()).catch(() => false)
  if (!isDir) return { root, epics: [], tickets: [], error: { code: 'failed', message: `Project folder not found: ${root}` } }
  try {
    return await enrichSnapshot(root, parseEpicStatus(await run(root, null)), ticketsRoot)
  } catch (error) {
    return { root, epics: [], tickets: [], error: errorOf(error) }
  }
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
 * Brings the branch cache up to date: a branch is read again only when its head moved or it is
 * new; branches whose worktree is gone, or whose Ticket the checkout does not know, drop out.
 */
export async function readBranches(
  root: string,
  checkout: CheckoutModel,
  worktrees: TicketWorktree[],
  previous: BranchCache,
  run: EpicStatusRunner,
  concurrency = 4,
): Promise<BranchCache> {
  const known = new Set(checkout.tickets.map(ticketKey))
  const next: BranchCache = new Map()
  const stale: TicketWorktree[] = []
  for (const worktree of worktrees) {
    const ref = parseTicketBranch(worktree.branch)!
    if (!known.has(ticketKey(ref)) || next.has(worktree.branch)) continue
    const cached = previous.get(worktree.branch)
    if (cached && cached.head === worktree.head) next.set(worktree.branch, cached)
    else stale.push(worktree)
  }

  const fresh = await inPool(
    stale.map((worktree) => async (): Promise<[string, BranchSnapshot]> => {
      const ref = parseTicketBranch(worktree.branch)!
      try {
        const snapshot = parseEpicStatus(await run(root, worktree.branch))
        const own = snapshot.tickets.find((ticket) => ticket.epic === ref.epic && ticket.num === ref.num)
        const ticket = own ? { epic: own.epic, num: own.num, state: own.state, statusRaw: own.statusRaw } : null
        return [worktree.branch, { head: worktree.head, ticket, error: null }]
      } catch (error) {
        return [worktree.branch, { head: worktree.head, ticket: null, error: errorOf(error).message }]
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
 * Lays the branch statuses over the checkout. A branch's Ticket takes the branch's `state` and
 * `statusRaw` and gets `fromBranch` when branchOverrides says so and the checkout does not already
 * say the same (the claim was merged).
 */
export function applyBranches(checkout: CheckoutModel, branches: BranchCache): WorkflowModel {
  const overrides = new Map<string, { branch: string; snapshot: BranchSnapshot }>()
  const branchErrors: BranchError[] = []
  for (const [branch, snapshot] of [...branches.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (snapshot.error !== null) branchErrors.push({ branch, message: snapshot.error })
    if (snapshot.ticket) overrides.set(ticketKey(snapshot.ticket), { branch, snapshot })
  }
  const tickets = checkout.tickets.map((ticket) => {
    const override = overrides.get(ticketKey(ticket))
    const fromBranch = override?.snapshot.ticket
    if (!override || !fromBranch || !branchOverrides(ticket.state, fromBranch.state) || fromBranch.statusRaw === ticket.statusRaw) return ticket
    return { ...ticket, state: fromBranch.state, statusRaw: fromBranch.statusRaw, fromBranch: override.branch }
  })
  return { ...checkout, tickets, branchErrors }
}

/** One full read: the checkout, then, in Full mode, every Ticket worktree branch. Never throws. */
export async function readWorkflow(
  options: ReaderOptions,
  run: EpicStatusRunner = epicStatusRunner(options.claudeHome),
  previous: BranchCache = new Map(),
): Promise<{ model: WorkflowModel; checkout: CheckoutModel; branches: BranchCache }> {
  const root = resolve(options.root)
  const layout = options.layout ?? (await readProjectLayout({ root, claudeHome: options.claudeHome }))
  const checkout = await readCheckout(root, run, layout.ticketsRoot)
  // Silent mode: no `--ref` (the Harness answers it with exit code 3), no status from branches.
  if (checkout.error || layout.mode === 'silent') return { model: { ...checkout, branchErrors: [] }, checkout, branches: new Map() }
  const branches = await readBranches(root, checkout, await ticketWorktrees(root), previous, run, options.concurrency)
  return { model: applyBranches(checkout, branches), checkout, branches }
}
