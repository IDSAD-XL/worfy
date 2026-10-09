// Where a Project's workflow lives (worfy-harness ticket 23; ADR-0042, ADR-0045): its mode, its
// Workflow folder, the root of its Tickets and its repositories.
//
// In Full mode the workflow files travel with the repository: the Tickets are in `<root>/.scratch`
// (or the Profile's `tickets.root`), HANDOFF.md and docs/adr in the root. In Silent mode they live
// in the Workflow folder, outside the repository, and a Project may span several repositories (a
// folder above them that is not a repository itself). worfy asks the Harness, as for everything
// about the workflow: `profile -C <root> --json` gives the mode, the Workflow folder and the
// repositories; `ticket root`, run in the root, gives the Tickets root — the same answer
// `epic-status` itself reads its Tickets from.
//
// Every way of not getting an answer — exit code 3 or 4, no script, a failed run, a Harness from
// before Silent mode — is Full mode with the Project root as the Workflow folder, one repository
// and `<root>/.scratch`, as worfy read every Project before; the reason is logged once per Project.
//
// Nothing here writes: both scripts run with the Project as cwd and only read.
import { isAbsolute, join, resolve } from 'node:path'
import { claudeHome } from '../storage/paths'
import { harnessScriptRunner, readResolvedProfile, type ProfileEnv, type ProfileRunner, type ResolvedRepo } from './profile'

export type ProjectRepo = ResolvedRepo

/** Where the workflow of the Project at `root` lives. */
export interface ProjectLayout {
  /** The Project root the layout was read for. */
  root: string
  mode: 'full' | 'silent'
  /** Root of HANDOFF.md and docs/adr: the Project root in Full mode, the Workflow folder in Silent mode. */
  workflowFolder: string
  /** The folder with `<epic>/spec.md` and `<epic>/issues/`. */
  ticketsRoot: string
  /** The Project's repositories; empty when the Harness did not say. More than one: a Project over several repositories. */
  repos: readonly ProjectRepo[]
  /** The folder above the repositories, when the root is one; else null. */
  workspace: string | null
  /** Why this is the Full-mode fallback; null when the Harness answered. */
  reason: string | null
}

/** Full mode as worfy read every Project before Silent mode existed. */
export function fullLayout(root: string, reason: string | null = null): ProjectLayout {
  const resolved = resolve(root)
  return { root: resolved, mode: 'full', workflowFolder: resolved, ticketsRoot: join(resolved, '.scratch'), repos: [], workspace: null, reason }
}

export interface ReadLayoutOptions {
  /** The Project root. */
  root: string
  /** Claude Code's home; the scripts are those of the Harness found from it. */
  claudeHome: string
  /** The scripts' environment; worfy's own by default, as for `epic-status` (src/main/workflow/reader.ts). */
  env?: ProfileEnv | undefined
  /** Replaces `bin/profile` in tests. */
  run?: ProfileRunner | undefined
  /** Replaces `bin/ticket` in tests. */
  runTicket?: ProfileRunner | undefined
  /** Where the reason for a fallback goes; console.warn once per Project and reason by default. */
  log?: ((message: string) => void) | undefined
}

/** The last reason logged for each Project root, so a fallback is one line per Project, not one per read. */
const logged = new Map<string, string>()

function logOnce(root: string, message: string): void {
  if (logged.get(root) === message) return
  logged.set(root, message)
  console.warn(message)
}

/** The Tickets root from `ticket root` run in the Project root, or null with the reason. */
async function ticketsRootOf(root: string, run: ProfileRunner): Promise<{ path: string } | { reason: string }> {
  try {
    const result = await run(root, ['root'])
    const path = result.stdout.trim().split('\n').at(-1)?.trim() ?? ''
    if (result.code !== 0) return { reason: `ticket root failed with exit code ${result.code ?? 'timeout'}${result.stderr.trim() ? `: ${result.stderr.trim()}` : ''}` }
    if (!isAbsolute(path) || path.includes('\0')) return { reason: `ticket root printed no absolute path: ${JSON.stringify(path.slice(0, 200))}` }
    return { path }
  } catch (error) {
    return { reason: `ticket root could not be run: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Reads where the workflow of the Project at `root` lives; never throws (see the top of the file). */
export async function readProjectLayout(options: ReadLayoutOptions): Promise<ProjectLayout> {
  const root = resolve(options.root)
  const env = options.env ?? process.env
  const log = options.log ?? ((message: string) => logOnce(root, message))
  const read = await readResolvedProfile({ root, claudeHome: options.claudeHome, env, run: options.run, log: () => undefined })
  if (!read.ok) {
    log(`[workflow] ${root}: Full mode, the workflow files in the Project root, because ${read.reason}`)
    return fullLayout(root, read.reason)
  }
  const { mode, workspace, repos } = read.profile
  // Full mode: the workflow files are in the root worfy shows, whatever spelling of it the Harness printed.
  const workflowFolder = mode === 'silent' ? read.profile.workflowFolder : root
  const tickets = await ticketsRootOf(root, options.runTicket ?? harnessScriptRunner(options.claudeHome, env, 'ticket'))
  if ('reason' in tickets) log(`[workflow] ${root}: the Tickets are read from ${join(workflowFolder, '.scratch')}, because ${tickets.reason}`)
  const ticketsRoot = 'path' in tickets ? tickets.path : join(workflowFolder, '.scratch')
  return { root, mode, workflowFolder, ticketsRoot, repos, workspace, reason: null }
}

export interface LayoutCacheOptions {
  claudeHome: () => string
  env?: () => ProfileEnv
  /** How long an answer is kept (default 30 s): a changed Profile counts within that time, without a restart. */
  ttlMs?: number
  now?: () => number
}

/**
 * The layouts of the Projects, each read at most once per `ttlMs` and once at a time: the checks
 * poll and the documents ask often, and one `profile` run costs a Node start.
 */
export class LayoutCache {
  private readonly entries = new Map<string, { at: number; layout: Promise<ProjectLayout> }>()

  constructor(private readonly options: LayoutCacheOptions) {}

  get(root: string): Promise<ProjectLayout> {
    const key = resolve(root)
    const now = (this.options.now ?? Date.now)()
    const cached = this.entries.get(key)
    if (cached && now - cached.at < (this.options.ttlMs ?? 30_000)) return cached.layout
    const layout = readProjectLayout({ root: key, claudeHome: this.options.claudeHome(), env: this.options.env?.() })
    this.entries.set(key, { at: now, layout })
    return layout
  }
}

let shared: LayoutCache | undefined

/** The app's one cache, over the Claude home of the running app (WORFY_CLAUDE_HOME or ~/.claude). */
export function projectLayouts(): LayoutCache {
  shared ??= new LayoutCache({ claudeHome: () => claudeHome() })
  return shared
}
