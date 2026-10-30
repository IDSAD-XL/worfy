// Removing the Demo project of Getting started with one button (worfy-onboarding ticket 10; spec,
// decision 7 and R12 "what the removal takes away"). Nothing removes the demo by itself: neither
// Skip, nor Done, nor a restart.
//
// Before anything is asked, the folder of the record `demo` must prove to be the demo worfy made:
//   - it is never the root of a disk, the home folder, a folder that holds the home folder, nor
//     worfy's data folder or a folder inside or above it (protectedReason);
//   - `bin/profile -C <folder> --name` answers `worfy-demo`, and that Profile is the demo's: every gate
//     registry entry of it names this folder (profileIsOurs of demo.ts, the check of its forget()).
// Otherwise the answer is a refusal and nothing is touched. Then:
//   1. the native dialog with the text of the spec and the folder; Cancel — nothing;
//   2. the demo's Orchestrator stops, and every Session and Terminal whose folder is inside the demo's
//      is closed and waited for: Windows refuses to delete a folder a process works in. Until the
//      removal ends, whether it removed everything or not, the demo's Orchestrator is not opened —
//      neither by main itself nor for a window, whose `orchestrator.open` answers that the project
//      is being removed (keepClosed of src/main/agent/app-orchestrators.ts) — so no Session starts there;
//   3. `project-connect --remove worfy-demo`: the Profile, its gate registry entries, runs/worfy-demo/;
//   4. the Project leaves the list, and its worfy data folder is deleted;
//   5. the record `demo` goes, and steps 2–6 with it; step 1 stays. Before the folder, not after: the
//      Stages of the demo (a window's Pipeline, the marking of the steps) watch the folder while the
//      record names it, and a watched folder is busy on Windows;
//   6. the folder is deleted, tried again after a pause while it stays (on Windows files are let go
//      a moment after their process ends). What stays is named in the answer, with the reason.
// Claude Code's transcripts in ~/.claude/projects stay: they are Claude Code's data, not worfy's.
//
// Everything that reaches outside comes in through RemoveDeps, so the contract test runs it over
// temporary folders (src/main/ipc/getting-started.ts wires the app's).
import { existsSync, readdirSync } from 'node:fs'
import { isAbsolute, parse } from 'node:path'
import type { RemoveDemoResult } from '../../shared/ipc/getting-started'
import { isInsidePath } from '../claude-home/registry'
import type { ConnectScript } from '../projects/connect'
import { realpathOrSelf } from '../projects/real-path'
import { removeTree } from '../storage/remove'
import { DEMO_PROFILE, profileIsOurs, removeDemoProfile, type DemoDeps } from './demo'
import type { DemoRecord, GettingStartedState } from './state'

/** How many times a folder is asked to go, with FOLDER_PAUSE_MS between two tries. */
export const FOLDER_TRIES = 5
export const FOLDER_PAUSE_MS = 1000

/** The confirmation of the spec, section "Texts (draft)", screen Done. */
export function removeConfirmation(folder: string): {
  message: string
  detail: string
} {
  return {
    message: 'Remove the demo project?',
    detail: `worfy closes the demo's Sessions, then deletes the folder ${folder}, and its worfy settings. This cannot be undone.`,
  }
}

export interface RemoveDeps {
  /** The user's home folder (os.homedir()). */
  home: string
  /** worfy's data folder (dataRoot()). */
  dataRoot: string
  /** The native dialog; true only for "Confirm". */
  confirm: (folder: string) => Promise<boolean>
  /** `bin/profile -C <folder> --name`; rejects only when it cannot be started. */
  profileName: (folder: string) => Promise<{ code: number | null; stdout: string }>
  registeredRepos: DemoDeps['registeredRepos']
  /** `bin/project-connect` of the Harness on the machine. */
  connect: ConnectScript
  projects: {
    find(id: string): unknown
    /** Takes the Project out of the list (its Layout written and forgotten, as `projects.remove` does). */
    remove(id: string): void
    dataDir(id: string): string
  }
  /**
   * Stops the Project's Orchestrator and keeps main from opening it again by itself (a new window,
   * the active Project); the returned function lets go. Held until the removal ends.
   */
  stopOrchestrator: (projectId: string) => () => void
  /** The live Sessions; close() resolves once the Session's processes have exited. */
  sessions: {
    list(): readonly { sessionId: string; cwd: string }[]
    close(sessionId: string): Promise<void>
  }
  /** The Terminals with their folder (null: unknown); close() resolves once the shell has exited. */
  terminals: {
    list(): readonly { key: string; cwd: string | null }[]
    close(key: string): Promise<void>
  }
  state: Pick<GettingStartedState, 'demo' | 'forgetDemo'>
  /** removeTree of src/main/storage/remove.ts when absent. */
  removeTree?: (path: string) => void
  /** Waits between two tries; a timer when absent. */
  wait?: (ms: number) => Promise<void>
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const refused = (reason: string): RemoveDemoResult => ({
  removed: false,
  reason,
})

/** The folder as given and as it is on disk: a link on the way (/tmp, /var on macOS) spells it twice. */
const spellings = (path: string): string[] => [...new Set([path, realpathOrSelf(path)])]

/** Whether `path` is `root` or inside it, by either spelling of each. */
function within(path: string, root: string): boolean {
  return spellings(path).some((one) => spellings(root).some((other) => isInsidePath(one.normalize('NFC'), other.normalize('NFC'))))
}

/**
 * Why `folder` may never be deleted, or null. Each guard has its own reason: the root of a disk, the
 * home folder, a folder that holds it, worfy's data folder or a folder inside or above it.
 */
export function protectedReason(folder: string, places: { home: string; dataRoot: string }): string | null {
  if (!isAbsolute(folder)) return `${folder} is not an absolute path`
  if (spellings(folder).some((one) => parse(one).root === one)) return `${folder} is the root of a disk`
  if (within(folder, places.home) && within(places.home, folder)) return `${folder} is your home folder`
  if (within(places.home, folder)) return `${folder} holds your home folder`
  if (within(folder, places.dataRoot) || within(places.dataRoot, folder)) return `${folder} is worfy's data folder or overlaps it`
  return null
}

/** Why the record's folder is not proven to be the demo worfy made, or null when it is. */
async function notOurs(deps: RemoveDeps, folder: string): Promise<string | null> {
  if (!existsSync(folder)) return `the folder ${folder} is not there`
  let run: { code: number | null; stdout: string }
  try {
    run = await deps.profileName(folder)
  } catch (error) {
    return `bin/profile could not be run: ${messageOf(error)}`
  }
  const name = run.stdout.trim()
  if (run.code !== 0 || name !== DEMO_PROFILE) {
    return `the Harness does not know ${folder} as the demo (bin/profile answers ${run.code === 0 ? `"${name}"` : `exit code ${String(run.code)}`}, not ${DEMO_PROFILE})`
  }
  if (!(await profileIsOurs(deps, { profile: DEMO_PROFILE, path: folder }))) {
    return `the Profile ${DEMO_PROFILE} of the Harness is not tied to ${folder} alone`
  }
  return null
}

/** Closes every Session and Terminal whose folder is inside `folder`, and waits for them. */
async function closeInside(deps: RemoveDeps, folder: string): Promise<void> {
  const inside = (cwd: string | null): boolean => cwd !== null && within(cwd, folder)
  const sessions = deps.sessions.list().filter((session) => inside(session.cwd))
  const terminals = deps.terminals.list().filter((terminal) => inside(terminal.cwd))
  const closing = [...sessions.map((session) => deps.sessions.close(session.sessionId)), ...terminals.map((terminal) => deps.terminals.close(terminal.key))]
  for (const result of await Promise.allSettled(closing)) {
    // Gone already, or not closable: the deletion below says what stays and why.
    if (result.status === 'rejected') console.warn('[getting-started] closing a Session or Terminal of the demo failed', result.reason)
  }
}

/** Why one try failed: the code and the path of the system's error, or its words. */
function whyOf(error: unknown): string {
  const { code, path } = (error ?? {}) as NodeJS.ErrnoException
  return code !== undefined ? `${code}${path !== undefined ? ` on ${path}` : ''}` : messageOf(error)
}

/**
 * Deletes `path`, again after a pause while it stays, FOLDER_TRIES times at most. Null when it is
 * gone; otherwise what stays and why.
 */
async function removeWithRetries(deps: RemoveDeps, path: string): Promise<string | null> {
  const remove = deps.removeTree ?? removeTree
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let why = 'it is still there'
  for (let attempt = 1; attempt <= FOLDER_TRIES; attempt++) {
    try {
      remove(path)
      if (!existsSync(path)) return null
      why = 'it is still there'
    } catch (error) {
      why = whyOf(error)
    }
    if (attempt < FOLDER_TRIES) await wait(FOLDER_PAUSE_MS)
  }
  let entries = ''
  try {
    entries = `, ${String(readdirSync(path).length)} entries left in it`
  } catch {
    // Not a folder any more, or not readable: the reason says enough.
  }
  return `the folder ${path} stays (${why}${entries})`
}

/**
 * Removes the Demo project after the user confirms (see the top of this file). Never throws: a
 * refusal or what stays is `{ removed: false, reason }`; Cancel is `{ removed: false, reason: null }`.
 */
export async function removeDemo(deps: RemoveDeps): Promise<RemoveDemoResult> {
  try {
    return await removeChecked(deps)
  } catch (error) {
    return refused(`The demo project was not removed: ${messageOf(error) || 'no reason given'}`)
  }
}

async function removeChecked(deps: RemoveDeps): Promise<RemoveDemoResult> {
  const record = deps.state.demo()
  if (record === null) return refused('There is no demo project to remove.')
  const folder = record.path
  const guarded = protectedReason(folder, deps)
  if (guarded !== null) return refused(`worfy does not delete it: ${guarded}.`)
  const foreign = await notOurs(deps, folder)
  if (foreign !== null) return refused(`Nothing was removed: ${foreign}.`)
  if (!(await deps.confirm(folder))) return { removed: false, reason: null }

  // Held until the folder is gone: a window that opens meanwhile would start the Orchestrator's
  // Session in the folder again.
  const release = deps.stopOrchestrator(record.projectId)
  try {
    return await removeConfirmed(deps, record)
  } finally {
    release()
  }
}

/** Steps 2–6 of the top of this file, once the user has confirmed. */
async function removeConfirmed(deps: RemoveDeps, record: DemoRecord): Promise<RemoveDemoResult> {
  const folder = record.path
  await closeInside(deps, folder)
  const failed = await removeDemoProfile(deps, DEMO_PROFILE)
  if (failed !== null)
    return refused(`The demo's Sessions were closed, but its Profile ${DEMO_PROFILE} could not be removed, so nothing was deleted: ${failed}`)
  if (deps.projects.find(record.projectId) !== undefined) deps.projects.remove(record.projectId)

  const left: string[] = []
  const data = deps.projects.dataDir(record.projectId)
  // The data folder of one Project lies inside worfy's data folder, never is it.
  if (within(data, deps.dataRoot) && !within(deps.dataRoot, data)) {
    const stays = await removeWithRetries(deps, data)
    if (stays !== null) left.push(`its worfy settings: ${stays}`)
  } else {
    left.push(`its worfy settings in ${data}, which is not inside ${deps.dataRoot}`)
  }
  deps.state.forgetDemo()
  const stays = await removeWithRetries(deps, folder)
  if (stays !== null) left.unshift(stays)
  if (left.length === 0) return { removed: true }
  return refused(
    `The demo's Sessions, Profile and place in the list were removed, but ${left.join('; ')}. Something may still hold a file there (an editor, a terminal outside worfy): close it, then delete what stays by hand.`,
  )
}

/** One removal at a time: a call while one runs gets that one's answer. */
export class DemoRemover {
  private running: Promise<RemoveDemoResult> | null = null

  /** `deps` is asked on each removal, so building the remover does no I/O. */
  constructor(private readonly deps: (confirm: RemoveDeps['confirm']) => RemoveDeps) {}

  remove(confirm: RemoveDeps['confirm']): Promise<RemoveDemoResult> {
    this.running ??= removeDemo(this.deps(confirm)).finally(() => {
      this.running = null
    })
    return this.running
  }
}
