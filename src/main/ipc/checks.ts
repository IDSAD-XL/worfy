// Handlers of the `checks` domain (src/shared/ipc/checks.ts): the gate state of a repository's
// worktrees and the pull requests of its Ticket branches. Read-only (ADR-0002, ADR-0005).
//
// A Project over several repositories (ADR-0045) gets its checks one repository at a time: the
// renderer asks `checks.repos` for them and `checks.get` for each. `git` and `gh` run only in a
// Project root or in one of its repositories, and `gh` looks up only `<epic>/<NN>` branches and the
// branches the workflow model names for that repository's Tickets (`Branch:`, Silent mode).
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { checksGet, checksRepos, type ChecksSnapshot, type ProjectRepos } from '../../shared/ipc/checks'
import { parseTicketBranch } from '../../shared/workflow/ticket-ref'
import type { WorkflowModel } from '../../shared/workflow/types'
import { agentEnv } from '../agent/env'
import { GateReader, listWorktrees, type Worktree } from '../gate/state'
import { accountAuth, ghRunner, PrTracker } from '../github/prs'
import { insideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { projectLayouts, type ProjectLayout, type ProjectRepo } from '../workflow/folder'
import { readGithubAccount } from '../workflow/profile'
import { defineHandler, type HandlerModule } from './index'
import { workflowHub } from './workflow'

export interface ChecksService {
  gate: GateReader
  prs: PrTracker
  /** Lists the Project's worktrees, the checkout first; `git worktree list` by default. */
  worktrees?: (root: string) => Promise<Worktree[]>
}

/**
 * Gate state of each worktree and the PRs of the Ticket branches: requested ones plus those of
 * worktrees whose branch is a Ticket's — `<epic>/<NN>`, or one `isTicketBranch` names.
 */
export async function readChecks(service: ChecksService, root: string, branches: readonly string[], isTicketBranch: (branch: string) => boolean = () => false): Promise<ChecksSnapshot> {
  const worktrees = await (service.worktrees ?? listWorktrees)(root)
  const worktreeBranches = worktrees.flatMap((worktree) => (worktree.branch !== null && (parseTicketBranch(worktree.branch) || isTicketBranch(worktree.branch)) ? [worktree.branch] : []))
  const [gated, prs] = await Promise.all([service.gate.read(root, worktrees), service.prs.read(root, [...new Set([...branches, ...worktreeBranches])])])
  return { root, worktrees: gated, pulls: prs.pulls, gh: prs.gh }
}

/** What main asks about a Project to know where its checks may run. */
export interface ChecksScope {
  /** Where the workflow of the Project at `root` lives, its repositories included. */
  layout(root: string): Promise<ProjectLayout>
  /** The workflow model of the Project at `root` when it is being watched; null otherwise. */
  model(root: string): Promise<WorkflowModel | null>
}

/** The app's: the shared layout cache and the models of the workflow hub. */
export const appChecksScope: ChecksScope = {
  layout: (root) => projectLayouts().get(root),
  model: (root) => workflowHub.model(root),
}

const realOrSelf = (path: string): string => {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** The same folder, by its path as given or by its real path. */
const sameFolder = (a: string, b: string): boolean => resolve(a) === resolve(b) || realOrSelf(a) === realOrSelf(b)

/** The Project whose root `root` is, or whose repository it is; null when it is neither for any Project. */
async function targetOf(root: string, projects: readonly { readonly path: string }[], scope: ChecksScope): Promise<{ project: string; repo: ProjectRepo | null; layout: ProjectLayout | null } | null> {
  const own = projects.find((project) => sameFolder(project.path, root))
  if (own) return { project: own.path, repo: null, layout: null }
  for (const project of projects) {
    const layout = await scope.layout(project.path)
    const repo = layout.repos.find((each) => sameFolder(each.path, root))
    if (repo) return { project: project.path, repo, layout }
  }
  return null
}

/**
 * The folder `root` is of the Project at `project`, which must be a Project of `projects`: its
 * root, or one of its repositories. Throws otherwise.
 */
async function targetIn(root: string, project: string, projects: readonly { readonly path: string }[], scope: ChecksScope): Promise<{ project: string; repo: ProjectRepo | null; layout: ProjectLayout | null }> {
  const asker = projects.find((each) => sameFolder(each.path, project))
  if (!asker) throw new Error(`${project} is not a Project of this Machine`)
  if (sameFolder(asker.path, root)) return { project: asker.path, repo: null, layout: null }
  const layout = await scope.layout(asker.path)
  const repo = layout.repos.find((each) => sameFolder(each.path, root))
  if (!repo) throw new Error(`${root} is not a folder of the Project ${asker.path}: neither its root nor one of its repositories`)
  return { project: asker.path, repo, layout }
}

/**
 * The branches the model names for Tickets checked in this root: every Ticket's in a Project of one
 * repository, only those of `repo`'s Tickets in a Project over several.
 */
function namedBranches(model: WorkflowModel | null, repo: ProjectRepo | null, layout: ProjectLayout | null): Set<string> {
  const several = layout !== null && layout.repos.length > 1
  return new Set((model?.tickets ?? []).flatMap((ticket) => (ticket.branch && (!several || ticket.repo === repo?.name) ? [ticket.branch] : [])))
}

/**
 * A call from a Linked machine names a root inside a Project of `projects` (src/main/link/caller.ts);
 * any call names a Project root or one of its repositories, and branches of its Tickets. A call
 * that names the Project asking (`project`) is judged by that Project alone: a repository of it
 * that is also a Project of its own still takes the branches of the asking Project's Tickets.
 */
export function checksHandlers(
  service: ChecksService,
  projects: () => readonly { readonly path: string }[] = () => projectStore().list(),
  scope: ChecksScope = appChecksScope,
): HandlerModule {
  return [
    defineHandler(checksGet, async ({ root, branches, project }, { event }) => {
      const resolved = insideProjects(event, resolve(root), projects, 'the Project root')
      // The Project that asks, when the caller names it: a Linked machine only one inside the Projects.
      const asker = project === undefined ? undefined : insideProjects(event, resolve(project), projects, 'the Project')
      const target = asker === undefined ? await targetOf(resolved, projects(), scope) : await targetIn(resolved, asker, projects(), scope)
      if (target === null) throw new Error(`${root} is neither the root of a Project nor one of its repositories`)
      const named = namedBranches(await scope.model(target.project), target.repo, target.layout)
      const foreign = branches.find((branch) => parseTicketBranch(branch) === null && !named.has(branch))
      if (foreign !== undefined) throw new Error(`${foreign} is not the branch of a Ticket of this Project`)
      return readChecks(service, resolved, branches, (branch) => named.has(branch))
    }),
    defineHandler(checksRepos, async ({ root }, { event }): Promise<ProjectRepos> => {
      const resolved = insideProjects(event, resolve(root), projects, 'the Project root')
      const project = projects().find((each) => sameFolder(each.path, resolved))
      if (!project) throw new Error(`${root} is not the root of a Project`)
      const layout = await scope.layout(project.path)
      return { mode: layout.mode, repos: layout.repos.map(({ name, path }) => ({ name, path })) }
    }),
  ]
}

export interface AppPrTrackerOptions {
  /** Claude Code's home, whose `bin/profile` names the Project's GitHub account. */
  claudeHome: string
  /** The gh executable; `gh` from the environment's PATH by default. */
  command?: string | undefined
  /** The environment of gh and of `bin/profile`. */
  env: () => Promise<Record<string, string | undefined>>
  /** Where the reason a Project has no account goes; console.warn by default. */
  log?: ((message: string) => void) | undefined
  now?: () => number
}

/**
 * The PR tracker with the Project's GitHub account (ADR-0020): each read runs gh with GH_TOKEN of
 * the account the Profile names, or with the environment's own account when it names none. The
 * Profile is read again on each read that runs gh, so an edited Profile counts without a restart;
 * the reason for no account is logged once per Project until it changes, not once a minute.
 */
export function appPrTracker(options: AppPrTrackerOptions): PrTracker {
  const run = ghRunner({ command: options.command, env: options.env })
  const log = options.log ?? ((message: string) => console.warn(message))
  const lastReason = new Map<string, string | null>()
  const account = async (root: string): Promise<string | null> => {
    const env = await options.env()
    let message: string | null = null
    const read = await readGithubAccount({ root, claudeHome: options.claudeHome, env, log: (line) => void (message = line) })
    if (lastReason.get(root) !== read.reason) {
      lastReason.set(root, read.reason)
      if (message !== null) log(message)
    }
    return read.account
  }
  return new PrTracker({ run, auth: accountAuth({ account, run }), ...(options.now ? { now: options.now } : {}) })
}

/**
 * The app's gh: WORFY_GH when set (tests point it at a stub) with the app's own environment, else
 * `gh` with the login shell's environment, since an app started from Finder has a bare PATH
 * (ADR-0007). The same environment runs `bin/profile`.
 */
function appPrs(): PrTracker {
  const stub = process.env.WORFY_GH
  const env = stub ? () => Promise.resolve(process.env) : async () => (await agentEnv()).env
  return appPrTracker({ claudeHome: claudeHome(), command: stub || undefined, env })
}

let sharedPrs: PrTracker | undefined

/**
 * The app's one PR tracker: the PR badges and the Autopilot run's narrow-round reads
 * (src/main/ipc/autopilot.ts, worfy-harness ticket 20) share it, so gh runs at most once per
 * interval for both.
 */
export function sharedPrTracker(): PrTracker {
  sharedPrs ??= appPrs()
  return sharedPrs
}

export default checksHandlers({ gate: new GateReader({ home: claudeHome() }), prs: sharedPrTracker() })
