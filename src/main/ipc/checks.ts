// Handlers of the `checks` domain (src/shared/ipc/checks.ts): the gate state of a Project's
// worktrees and the pull requests of its Ticket branches. Read-only (ADR-0002, ADR-0005).
import { resolve } from 'node:path'
import { checksGet, type ChecksSnapshot } from '../../shared/ipc/checks'
import { parseTicketBranch } from '../../shared/workflow/ticket-ref'
import { agentEnv } from '../agent/env'
import { GateReader, listWorktrees, type Worktree } from '../gate/state'
import { ghRunner, PrTracker } from '../github/prs'
import { claudeHome } from '../storage/paths'
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

export function checksHandlers(service: ChecksService): HandlerModule {
  return [defineHandler(checksGet, ({ root, branches }) => readChecks(service, resolve(root), branches))]
}

/**
 * The app's gh: WORFY_GH when set (tests point it at a stub), else `gh` from the login shell's
 * PATH, since an app started from Finder has a bare PATH (ADR-0007).
 */
function appGhRunner() {
  const stub = process.env.WORFY_GH
  if (stub) return ghRunner({ command: stub })
  return ghRunner({ env: async () => (await agentEnv()).env })
}

export default checksHandlers({ gate: new GateReader({ home: claudeHome() }), prs: new PrTracker({ run: appGhRunner() }) })
