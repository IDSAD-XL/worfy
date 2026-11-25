// The check of the CI of the Projects' main branches (worfy-assistant ticket 21): the `ci` source of the attention core
// for the duty «CI of the main branch is red». Each run reads, for every Project of this Machine, the default branch of
// each of its repositories on github.com (src/main/github/main-ci.ts) and gives the read to mainCiAttention with the
// duty's threshold in force. It runs through the scheduler of checks (ticket 04), as kind `main-ci`: interval, sleep
// outside work hours and the catch-up after the Mac's sleep come from there, and the kind is off until the person turns
// it on (ASSISTANT_CHECK_DEFAULTS). It is registered there only while the duty is enabled (followMainCiDuty).
//
// - A Project without a repository on github.com is not read: no gh call, no item.
// - A failed read — gh failed, no gh login for the Project's account, an answer that cannot be read, a layout that
//   cannot be read — goes to the log once per Project and repository until its reason changes, and is no item; the
//   next run reads again. One Project that fails does not stop the others.
// - The marker `main-red` of land is not read: it is worfy's own process, and duties do not name it (ticket 07).
import { readMainBranchCi } from '../../github/main-ci'
import type { CheckKind } from '../../../shared/assistant/schedule/settings'
import type { AttentionCore } from '../core/attention-core'
import type { CheckRun, CheckScheduler } from '../schedule/scheduler'
import { mainCiAttention } from './main-ci'

/** The kind of the check in the scheduler and in the settings of checks. */
export const MAIN_CI_KIND = 'main-ci' satisfies CheckKind

/** The duty whose items the check gives. */
export const MAIN_CI_DUTY = 'main-ci-red'

export interface MainCiCheckOptions {
  /** The Projects of this Machine and their roots. */
  projects: () => readonly { id: string; root: string }[]
  /** The repositories of a Project on github.com, as `owner/name` (remoteRepos of its folders); none for a Project without. */
  repos: (root: string) => Promise<readonly string[]>
  /** Runs a read-only gh command in a Project's root as the Project's GitHub account (PrTracker.gh). */
  gh: (root: string, args: readonly string[]) => Promise<string>
  core: Pick<AttentionCore, 'expect' | 'resolve'>
  /** The threshold of the duty in force, in ms (Duties.thresholdMs). */
  thresholdMs: () => number
  now?: () => number
  log?: (message: string) => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The run of the check: every Project, one after another. It does not reject: a failure is logged and costs its Project. */
export function mainCiCheck(options: MainCiCheckOptions): CheckRun {
  const log = options.log ?? ((message: string) => console.warn(message))
  const logged = new Map<string, string>()
  const failed = (key: string, what: string, error: unknown): void => {
    const reason = messageOf(error)
    if (logged.get(key) === reason) return
    logged.set(key, reason)
    log(`[assistant] the CI of ${what} was not read: ${reason}`)
  }
  return async () => {
    for (const project of options.projects()) {
      let repos: readonly string[]
      try {
        repos = await options.repos(project.root)
        logged.delete(project.root)
      } catch (error) {
        failed(project.root, `the repositories of ${project.root}`, error)
        continue
      }
      for (const repo of repos) {
        const key = `${project.root}\n${repo}`
        try {
          const read = await readMainBranchCi((args) => options.gh(project.root, args), repo, options.now)
          logged.delete(key)
          if (read !== null) mainCiAttention(options.core, { projectId: project.id, ...read }, options.thresholdMs())
        } catch (error) {
          failed(key, `the main branch of ${repo}`, error)
        }
      }
    }
  }
}

/** The duty as the check follows it: whether it is enabled, and its changes (Duties). */
export interface MainCiDuty {
  enabled(id: string): boolean
  onChange(listener: () => void): () => void
}

/**
 * Keeps the check registered in `scheduler` while the duty «CI of the main branch is red» is enabled, and not while it
 * is disabled; answers the function that stops following and removes the check.
 */
export function followMainCiDuty(scheduler: Pick<CheckScheduler, 'register'>, duty: MainCiDuty, run: CheckRun): () => void {
  let unregister: (() => void) | null = null
  const follow = (): void => {
    const enabled = duty.enabled(MAIN_CI_DUTY)
    if (enabled && unregister === null) unregister = scheduler.register(MAIN_CI_KIND, run)
    else if (!enabled && unregister !== null) {
      unregister()
      unregister = null
    }
  }
  const stop = duty.onChange(follow)
  follow()
  return () => {
    stop()
    unregister?.()
    unregister = null
  }
}
