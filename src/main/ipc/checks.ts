// Handlers of the `checks` domain (src/shared/ipc/checks.ts): the gate state of a Project's
// worktrees and the pull requests of its Ticket branches. Read-only (ADR-0002, ADR-0005).
import { resolve } from 'node:path'
import { checksGet, type ChecksSnapshot } from '../../shared/ipc/checks'
import { parseTicketBranch } from '../../shared/workflow/ticket-ref'
import { agentEnv } from '../agent/env'
import { GateReader, listWorktrees, type Worktree } from '../gate/state'
import { accountAuth, ghRunner, PrTracker } from '../github/prs'
import { insideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { readGithubAccount } from '../workflow/profile'
import { defineHandler, type HandlerModule } from './index'

export interface ChecksService {
  gate: GateReader
  prs: PrTracker
  /** Lists the Project's worktrees, the checkout first; `git worktree list` by default. */
  worktrees?: (root: string) => Promise<Worktree[]>
}

/** Gate state of each worktree and the PRs of the Ticket branches: requested ones plus those of worktrees. */
export async function readChecks(service: ChecksService, root: string, branches: readonly string[]): Promise<ChecksSnapshot> {
  const worktrees = await (service.worktrees ?? listWorktrees)(root)
  const worktreeBranches = worktrees.flatMap((worktree) => (worktree.branch !== null && parseTicketBranch(worktree.branch) ? [worktree.branch] : []))
  const [gated, prs] = await Promise.all([service.gate.read(root, worktrees), service.prs.read(root, [...new Set([...branches, ...worktreeBranches])])])
  return { root, worktrees: gated, pulls: prs.pulls, gh: prs.gh }
}

/** A call from a Linked machine names a root inside a Project of `projects` (src/main/link/caller.ts). */
export function checksHandlers(service: ChecksService, projects: () => readonly { readonly path: string }[] = () => projectStore().list()): HandlerModule {
  return [
    defineHandler(checksGet, ({ root, branches }, { event }) => {
      const resolved = resolve(root)
      insideProjects(event, resolved, projects, 'the Project root')
      return readChecks(service, resolved, branches)
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
