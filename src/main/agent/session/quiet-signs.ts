// What a Session reads to tell a quiet turn (worfy-stuck-agents ticket 03; the rule is quietFor of
// src/shared/agent/quiet.ts): how often it looks, and the signs of life that are no events of its agent.
//
// Those are read only from the file system, and only once the agent's events alone say the turn is quiet:
// - the output files of the Session's live background tasks, named by the tool results that started them
//   (src/main/autopilot/task-output.ts);
// - the output of a gate running in the Session's worktree: `.run-<tag>-<pid>.out` in the state folder of
//   the Gate (harness/hooks/gate.mjs, captured()), `tag` as src/main/gate/state.ts computes it;
// - the e2e lock of the Project's Profile (`workflow.e2e_lock`), held by a process that runs: its
//   holder.json names the pid, the host and the gate's child (harness/lib/e2e-lock.cjs).
// A read that fails is no sign of life: the turn is then judged by its events, as before.
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { QUIET_MARK_MS, type QuietFacts } from '../../../shared/agent/quiet'
import { outputMarks } from '../../autopilot/task-output'
import { gateTag } from '../../gate/state'
import { currentHarness } from '../../harness/locate'
import { harnessScriptEnv } from '../../harness/script-env'
import { claudeHome } from '../../storage/paths'
import { readPipelineProfile } from '../../workflow/profile'

/** How often a Session in a turn looks whether it went quiet: once a minute, so `quiet` goes out at most that often. */
export const QUIET_LOOK_MS = 60_000

/** Where the signs of life outside the agent's events are looked for. */
export interface QuietPlace {
  /** The Session's folder: the worktree whose gate counts, and the root of the Profile. */
  cwd: string
  /** The output file of each live background task of the Session that a tool result named, by task id. */
  taskOutputs: ReadonlyMap<string, string>
}

export type OutsideSigns = Pick<QuietFacts, 'taskOutputAt' | 'gateOutputAt' | 'e2eLockHeld'>

/** No sign of life outside the events. */
export const NO_OUTSIDE_SIGNS: OutsideSigns = { taskOutputAt: null, gateOutputAt: null, e2eLockHeld: false }

/** How a Session watches its turns for quiet; tests give their own threshold, period, clock and signs. */
export interface QuietWatch {
  /** After how long without a sign of life the turn is marked quiet. */
  markMs: number
  /** How often a Session in a turn looks. */
  lookMs: number
  now: () => number
  /** The signs of life outside the agent's events; never rejects. */
  outside: (place: QuietPlace) => Promise<OutsideSigns>
}

/** The app's watch, one per Session: the Profile's e2e lock is read once, at the first look that needs it. */
export function defaultQuietWatch(): QuietWatch {
  return { markMs: QUIET_MARK_MS, lookMs: QUIET_LOOK_MS, now: () => Date.now(), outside: outsideSignsReader() }
}

/**
 * Reads the signs of life of a place; the e2e lock's folder is asked of the Profile once per reader (a Session's
 * folder does not change). `gateDir`: the Gate's folder of the Harness on the machine now, looked for at each read.
 */
export function outsideSignsReader(
  lockFolderOf: (cwd: string) => Promise<string | null> = profileLockFolder,
  gateDir: () => string = () => currentHarness().gateDir,
): (place: QuietPlace) => Promise<OutsideSigns> {
  let folder: Promise<string | null> | null = null
  return async (place) => {
    folder ??= lockFolderOf(place.cwd).catch(() => null)
    const [gateAt, lock] = await Promise.all([gateOutputAt(place.cwd, gateDir), folder])
    return { taskOutputAt: taskOutputAt(place.taskOutputs), gateOutputAt: gateAt, e2eLockHeld: lock !== null && (await lockHeld(lock)) }
  }
}

const latest = (times: readonly number[]): number | null => (times.length === 0 ? null : Math.max(...times))

/** The latest change of the output files of the live background tasks; null when none can be read. */
export function taskOutputAt(files: ReadonlyMap<string, string>): number | null {
  const marks = outputMarks(files, [...files.keys()].map((taskId) => ({ taskId })))
  return latest([...marks.values()].flatMap((mark) => (mark === null ? [] : [mark.mtimeMs])))
}

/** The latest change of an output file of a gate running in the worktree `cwd`; null when there is none. */
export async function gateOutputAt(cwd: string, gateDir: () => string = () => currentHarness().gateDir): Promise<number | null> {
  try {
    const state = join(gateDir(), 'state')
    // The Gate's tag is of the worktree as git names it: its real path.
    const prefix = `.run-${gateTag(await realpath(cwd))}-`
    const names = (await readdir(state)).filter((name) => name.startsWith(prefix) && name.endsWith('.out'))
    const times = await Promise.all(names.map((name) => stat(join(state, name)).then((info) => info.mtimeMs, () => null)))
    return latest(times.filter((time): time is number => time !== null))
  } catch {
    return null
  }
}

/** Whether a process with this pid runs on this machine. */
function running(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it runs, under another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Whether the e2e lock in `folder` is held by a process that runs: its holder.json names this machine (or no
 * machine) and a pid, or the gate's child, that runs. A lock without a holder.json, or of another machine, is not.
 * shortcut: a pid Windows has handed to a new process counts as the holder; e2e-lock.cjs compares start times.
 */
export async function lockHeld(folder: string): Promise<boolean> {
  try {
    const holder: unknown = JSON.parse(await readFile(join(folder, 'holder.json'), 'utf8'))
    if (typeof holder !== 'object' || holder === null) return false
    const { pid, host, child } = holder as { pid?: unknown; host?: unknown; child?: unknown }
    if (host !== undefined && host !== hostname()) return false
    return running(pid) || running(child)
  } catch {
    return false
  }
}

/** The e2e lock of the Profile of `cwd` (`workflow.e2e_lock`); null without a Profile or a lock. */
async function profileLockFolder(cwd: string): Promise<string | null> {
  const read = await readPipelineProfile({ root: cwd, claudeHome: claudeHome(), env: await harnessScriptEnv() })
  return read.ok ? read.profile.e2eLock : null
}
