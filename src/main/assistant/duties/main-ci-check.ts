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
// - A red condition stays armed only while reads keep finding the branch red: one no run read again (a failed read, a
//   repository or Project gone) is dropped, and so is everything armed once the check stops being read (the duty
//   disabled, the check turned off, the app quits). An item already raised stays.
// - The marker `main-red` of land is not read: it is worfy's own process, and duties do not name it (ticket 07).
import { readMainBranchCi } from '../../github/main-ci'
import type { CheckKind } from '../../../shared/assistant/schedule/settings'
import type { AttentionCore } from '../core/attention-core'
import type { CheckRun, CheckScheduler } from '../schedule/scheduler'
import { mainCiAttention, mainCiId } from './main-ci'

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
  core: Pick<AttentionCore, 'expect' | 'resolve' | 'disarm'>
  /** The threshold of the duty in force, in ms (Duties.thresholdMs). */
  thresholdMs: () => number
  now?: () => number
  log?: (message: string) => void
}

/** The check: its run, and disarm(). */
export interface MainCiCheck {
  run: CheckRun
  /**
   * Drops every red condition the check armed that has not raised its item yet; a run in progress arms nothing more.
   * For when the check stops being read: the duty disabled, the check turned off, the app quits.
   */
  disarm(): void
}

interface Armed {
  projectId: string
  id: string
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The check: every Project, one after another. A run does not reject: a failure is logged and costs its Project. */
export function mainCiCheck(options: MainCiCheckOptions): MainCiCheck {
  const log = options.log ?? ((message: string) => console.warn(message))
  const logged = new Map<string, string>()
  /** The red conditions armed by the last run, by Project root and repository. */
  let armed = new Map<string, Armed>()
  /** Grows with each disarm(): a run started before it arms nothing more. */
  let generation = 0
  const failed = (key: string, what: string, error: unknown): void => {
    const reason = messageOf(error)
    if (logged.get(key) === reason) return
    logged.set(key, reason)
    log(`[assistant] the CI of ${what} was not read: ${reason}`)
  }
  const drop = (conditions: Iterable<Armed>): void => {
    for (const { projectId, id } of conditions) options.core.disarm(projectId, id)
  }
  const run: CheckRun = async () => {
    const started = generation
    const red = new Map<string, Armed>()
    for (const project of options.projects()) {
      if (generation !== started) break
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
          if (generation !== started) break
          if (read === null) continue
          mainCiAttention(options.core, { projectId: project.id, ...read }, options.thresholdMs())
          if (read.state === 'red') red.set(key, { projectId: project.id, id: mainCiId(repo, read.branch) })
        } catch (error) {
          failed(key, `the main branch of ${repo}`, error)
        }
      }
    }
    if (generation !== started) {
      // disarm() came while this run read: what it armed before that goes too.
      drop(red.values())
      return
    }
    // Armed before and not found red again by this run: the read failed, or the repository is gone.
    drop([...armed].flatMap(([key, condition]) => (red.get(key)?.id === condition.id ? [] : [condition])))
    armed = red
  }
  return {
    run,
    disarm: () => {
      generation += 1
      drop(armed.values())
      armed = new Map()
    },
  }
}

/** The duty as the check follows it: whether it is enabled, and its changes (Duties). */
export interface MainCiDuty {
  enabled(id: string): boolean
  onChange(listener: () => void): () => void
}

/** Whether the person turned the check of kind `main-ci` on in the settings of checks, and the changes of those settings. */
export interface MainCiSwitch {
  enabled(): boolean
  onChange(listener: () => void): () => void
}

/**
 * Keeps the check registered in `scheduler` while the duty «CI of the main branch is red» is enabled, and not while it
 * is disabled; answers the function that stops following and removes the check. Whenever the check stops being read —
 * the duty disabled, the check turned off in `setting`, the stop — what it armed is disarmed.
 */
export function followMainCiDuty(scheduler: Pick<CheckScheduler, 'register'>, duty: MainCiDuty, check: MainCiCheck, setting?: MainCiSwitch): () => void {
  let unregister: (() => void) | null = null
  const follow = (): void => {
    const enabled = duty.enabled(MAIN_CI_DUTY)
    if (enabled && unregister === null) unregister = scheduler.register(MAIN_CI_KIND, check.run)
    else if (!enabled && unregister !== null) {
      unregister()
      unregister = null
      check.disarm()
    }
  }
  const switchedOff = (): void => {
    if (setting?.enabled() === false) check.disarm()
  }
  const stops = [duty.onChange(follow), ...(setting === undefined ? [] : [setting.onChange(switchedOff)])]
  follow()
  return () => {
    for (const stop of stops) stop()
    unregister?.()
    unregister = null
    check.disarm()
  }
}
