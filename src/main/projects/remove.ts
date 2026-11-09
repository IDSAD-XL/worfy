// "Remove project…" (worfy-polish ticket 79): the Project leaves this Machine's Harness, not only
// worfy's list, so its folders can be connected again ("Remove from list" keeps the Harness as it is,
// and its gate registry entries keep the paths taken: project-connect refuses a path already there).
//
// The Harness does the removal itself (ADR-0002: worfy changes the workflow only through its tools):
// `bin/project-connect --remove <profile>` deletes <Harness home>/projects/<profile>/ (with the default
// Workflow folder of a Silent mode Profile, only while that folder holds nothing but an empty
// `git init`), every gate registry entry of the Profile, <Harness home>/runs/<profile>/ and the qmd
// collections no other Profile names, in one commit, rolled back on a failure. It never touches a
// repository, nor a Workflow folder the user chose outside the Profile folder; it refuses a default
// Workflow folder that holds the project's own files or commits, and nothing is removed then. worfy
// deletes nothing itself.
//
// The order (the ticket's section on what to do):
//   1. the preview: the Profile of the Project's folder (`bin/profile -C <folder> --dir`), which must lie
//      in <Harness home>/projects/ — the only place `--remove` looks; a Profile in the old place
//      (~/.claude/profiles/, before the Harness plugin) is refused — and its gate registry entries, which
//      must all be the folder or inside it: a Profile that also covers paths outside it (the folder is
//      one repository of a Project over several) is refused, since removing it would take the others;
//   2. a default Workflow folder that holds files or commits is refused here, before anything closes;
//   3. the Orchestrators of the Project and of every other listed Project inside its folder (they share
//      the Profile) stop and stay closed, and every Session whose folder is inside the Project's is
//      closed and waited for; then worfy's own watches of those Projects (Tickets, documents) close
//      until the end: a Silent Project's Workflow folder lies in the Profile folder, and Windows
//      refuses the script's rename of a folder while a watch holds a handle inside it (EPERM);
//   4. `project-connect --remove <profile>`; a refusal or a failure leaves the Project in the list, with
//      the script's words. "No such profile" counts as done only when no registry entry of the Profile
//      is left: otherwise nothing was freed;
//   5. the Project leaves worfy's list (its data folder stays, as with "Remove from list"); the other
//      listed Projects inside its folder stay, without a Profile, and the answer says so;
//   6. whatever the answer, the Orchestrators are let go and the watches are made again.
//
// Everything that reaches outside comes in through ProjectRemovalDeps (src/main/ipc/projects.ts wires
// the app's), so the contract test runs it over a temporary Harness home.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { RemovalPreview } from '../../shared/ipc/projects'
import { isInsidePath } from '../claude-home/registry'
import type { ConnectScript, ScriptRun } from './connect'
import { realpathOrSelf } from './real-path'

interface ListedProject {
  id: string
  name: string
  path: string
}

export interface ProjectRemovalDeps {
  projects: {
    get(id: string): ListedProject
    list(): readonly ListedProject[]
    /** Takes the Project out of the list, as `projects.remove` does (its Layout written and forgotten). */
    remove(id: string): void
  }
  /** The Harness home `bin/project-connect` works in (HARNESS_HOME of its runs). */
  harnessHome: () => string
  /** The Profile folder of the folder: `bin/profile -C <folder> --dir`; throws with the reason when there is none. */
  profileDir: (root: string) => Promise<string>
  /** The `match` paths of the gate registry entries of a Profile. */
  registeredRepos: (profile: string) => Promise<readonly string[]>
  /** `bin/project-connect` of the Harness on the machine. */
  connect: ConnectScript
  /** Stops the Orchestrators of these Projects and keeps them closed; the returned function lets go. */
  stopOrchestrators: (projectIds: readonly string[]) => () => void
  /**
   * Closes worfy's own watches of these Projects (Tickets, documents) and keeps them closed; the
   * returned function watches them again. A Silent Project's Workflow folder lies in the Profile
   * folder, and Windows refuses to rename a folder while a watch holds a handle inside it.
   */
  holdWatches: (projects: readonly ListedProject[]) => Promise<() => Promise<void>>
  /** The live Sessions; close() resolves once the Session's processes have exited. */
  sessions: {
    list(): readonly { sessionId: string; cwd: string }[]
    close(sessionId: string): Promise<void>
  }
}

export type RemoveProjectResult = { status: 'removed'; notes: string[] } | { status: 'refused'; reason: string; workflowFolder: string | null }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The folder as given and as it is on disk: a link on the way (/tmp, /var on macOS) spells it twice. */
const spellings = (path: string): string[] => [...new Set([path, realpathOrSelf(path)])]

/** Whether `path` is `root` or inside it, by either spelling of each. */
function within(path: string, root: string): boolean {
  return spellings(path).some((one) => spellings(root).some((other) => isInsidePath(one.normalize('NFC'), other.normalize('NFC'))))
}

/** Whether two spellings name the same folder. */
const sameFolder = (one: string, other: string): boolean => within(one, other) && within(other, one)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The Profile's own file, or an empty object when it cannot be read: the Harness removes a broken one all the same. */
function readProfile(profileDir: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(profileDir, 'profile.json'), 'utf8'))
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Whether `folder` is a git repository of its own with at least one commit, as project-connect asks before it removes. */
function hasCommits(folder: string): boolean {
  if (!existsSync(join(folder, '.git'))) return false
  // GIT_* of a surrounding hook would point git at another repository.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return spawnSync('git', ['-C', folder, 'rev-parse', '-q', '--verify', 'HEAD'], { stdio: 'ignore', env }).status === 0
}

/**
 * The Workflow folder of a Silent mode Profile, as project-connect places it; null in Full mode.
 * `holdsFiles`: anything beside `.git`, or (for the default one, which `--remove` would delete) commits.
 */
function workflowFolderOf(profile: Record<string, unknown>, profileDir: string): { path: string; inside: boolean; holdsFiles: boolean } | null {
  if (profile.mode !== 'silent') return null
  const folder = isObject(profile.workflow) ? profile.workflow.folder : null
  const own = join(profileDir, 'workflow')
  const chosen = typeof folder === 'string' && folder.startsWith('~/') ? join(homedir(), folder.slice(2)) : folder
  const inside = typeof chosen !== 'string' || !isAbsolute(chosen) || sameFolder(chosen, own)
  const path = inside ? own : chosen
  let holdsFiles = false
  try {
    holdsFiles = existsSync(path) && (readdirSync(path).some((entry) => entry !== '.git') || (inside && hasCommits(path)))
  } catch {
    // Not readable: the Harness decides, and says why it refuses.
  }
  return { path, inside, holdsFiles }
}

const LIST_ONLY = '"Remove from list" takes it out of worfy\'s list only.'

/** The other listed Projects inside the folder of `project`: they resolve to its Profile. */
const listedInside = (deps: Pick<ProjectRemovalDeps, 'projects'>, project: ListedProject): ListedProject[] =>
  deps.projects.list().filter((other) => other.id !== project.id && within(other.path, project.path))

/** What "Remove project…" would remove for the Project `id`, or why it cannot. Never throws. */
export async function removalPreview(deps: Pick<ProjectRemovalDeps, 'projects' | 'harnessHome' | 'profileDir' | 'registeredRepos'>, id: string): Promise<RemovalPreview> {
  try {
    const project = deps.projects.get(id)
    let profileDir: string
    try {
      profileDir = await deps.profileDir(project.path)
    } catch (error) {
      const message = messageOf(error)
      // bin/profile's exit 3: the folder is in no registered project; anything else is a failure to say so.
      if (/exit code 3\b/.test(message)) return { status: 'refused', reason: `The Harness of this Machine has no Profile for ${project.path}, so none of its paths is taken. ${LIST_ONLY}` }
      return { status: 'refused', reason: `The Harness could not tell which Profile ${project.path} has: ${message}` }
    }
    const profile = basename(profileDir)
    const projectsDir = join(deps.harnessHome(), 'projects')
    if (!sameFolder(dirname(profileDir), projectsDir)) {
      return {
        status: 'refused',
        reason: `The Profile ${profile} is in the old Harness folder ${dirname(profileDir)}, and the Harness removes only Profiles in ${projectsDir}. Move the old Harness to the plugin first (Command palette: First-run checks), then remove the project. ${LIST_ONLY}`,
      }
    }
    const paths = [...(await deps.registeredRepos(profile))]
    if (paths.length === 0) {
      return { status: 'refused', reason: `The gate registry of this Machine has no registry entry of this Profile (${profile}), so there is no path to free. ${LIST_ONLY}` }
    }
    const outside = paths.filter((path) => !within(path, project.path))
    if (outside.length > 0) {
      return {
        status: 'refused',
        reason: `The Profile ${profile} also covers ${outside.join(', ')}, outside ${project.path}: removing it would remove those too. Remove the Project of the folder that holds them all instead.`,
      }
    }
    const stored = readProfile(profileDir)
    const qmd = isObject(stored.qmd) && Array.isArray(stored.qmd.collections) ? stored.qmd.collections.filter((name): name is string => typeof name === 'string' && name !== '') : []
    return {
      status: 'ready',
      profile,
      profileDir,
      paths,
      runs: join(deps.harnessHome(), 'runs', profile),
      qmd,
      mode: stored.mode === 'silent' ? 'silent' : 'full',
      workflowFolder: workflowFolderOf(stored, profileDir),
      alsoListed: listedInside(deps, project).map((other) => `${other.name} (${other.path})`),
    }
  } catch (error) {
    return { status: 'refused', reason: messageOf(error) }
  }
}

/** The messages of a refusal of bin/project-connect ({ ok: false, errors }), else the last line of its stderr. */
function scriptMessages(run: ScriptRun): string[] {
  try {
    const parsed = JSON.parse(run.stdout) as { errors?: unknown }
    if (Array.isArray(parsed.errors)) return parsed.errors.map((each: { message?: unknown }) => String(each.message ?? '')).filter(Boolean)
  } catch {
    // Not JSON: the reason is in stderr.
  }
  const last = run.stderr.trim().split('\n').pop()?.trim()
  return [last || `exit code ${run.code === null ? 'none' : String(run.code)}`]
}

type QmdAnswer = { status?: string; reason?: string | null; removed?: string[]; kept?: string[] }

/** What the Harness says beside a removal that held: qmd collections that stay, folders left behind. */
function notesOf(run: ScriptRun): string[] {
  let removed: { qmd?: QmdAnswer; leftover?: string[] } | undefined
  try {
    removed = (JSON.parse(run.stdout) as { removed?: { qmd?: QmdAnswer; leftover?: string[] } }).removed
  } catch {
    return []
  }
  const notes: string[] = []
  const qmd = removed?.qmd
  const kept = qmd?.kept ?? []
  if (qmd?.status === 'failed') notes.push(`Some qmd collections were not removed: ${qmd.reason ?? 'no reason given'}.`)
  else if (kept.length > 0) {
    const why = qmd?.status === 'removed' ? 'another Profile names them' : (qmd?.reason ?? 'the Harness kept them')
    notes.push(`The qmd collections ${kept.join(', ')} stay: ${why}.`)
  }
  for (const left of removed?.leftover ?? []) notes.push(`The Harness kept ${left}; delete it by hand once you no longer need it.`)
  return notes
}

const UPDATE_HARNESS = "This Harness's project-connect does not know --remove. Update the Harness plugin in the first-run checks (Command palette: First-run checks), then try again."

/** Closes every Session whose folder is inside `folder`, and waits for them. */
async function closeInside(deps: ProjectRemovalDeps, folder: string): Promise<void> {
  const closing = deps.sessions
    .list()
    .filter((session) => within(session.cwd, folder))
    .map((session) => deps.sessions.close(session.sessionId))
  for (const result of await Promise.allSettled(closing)) {
    // Gone already: nothing holds the Profile then.
    if (result.status === 'rejected') console.warn('[projects] closing a Session of a Project being removed failed', result.reason)
  }
}

/** Removes the Project `id` from the Harness, then from the list (see the top of this file). Never throws. */
export async function removeProject(deps: ProjectRemovalDeps, id: string): Promise<RemoveProjectResult> {
  const preview = await removalPreview(deps, id)
  if (preview.status === 'refused') return { status: 'refused', reason: preview.reason, workflowFolder: null }
  const folder = preview.workflowFolder
  if (folder !== null && folder.inside && folder.holdsFiles) {
    return {
      status: 'refused',
      reason: `The Workflow folder ${folder.path} holds the project's own files (its tickets). worfy does not delete them: move the folder ${folder.path} out of ${preview.profileDir} first. Nothing was removed.`,
      workflowFolder: folder.path,
    }
  }
  let project: ListedProject
  let others: ListedProject[]
  try {
    project = deps.projects.get(id)
    others = listedInside(deps, project)
  } catch (error) {
    return { status: 'refused', reason: messageOf(error), workflowFolder: null }
  }
  const release = deps.stopOrchestrators([project.id, ...others.map((other) => other.id)])
  let watchAgain: () => Promise<void> = () => Promise.resolve()
  try {
    await closeInside(deps, project.path)
    watchAgain = await deps.holdWatches([project, ...others])
    let run: ScriptRun
    try {
      run = await deps.connect(['--remove', preview.profile], '')
    } catch (error) {
      return { status: 'refused', reason: `The Harness could not be run: ${messageOf(error)}. The Project stays in the list.`, workflowFolder: null }
    }
    if (run.code === 2) return { status: 'refused', reason: UPDATE_HARNESS, workflowFolder: null }
    const messages = run.code === 0 ? [] : scriptMessages(run)
    // "No such profile" is done only when the registry has no entry of it left: its paths are free then.
    const gone = messages.length > 0 && messages.every((message) => message.startsWith(`no profile ${preview.profile}`))
    if (gone) {
      const left = await deps.registeredRepos(preview.profile)
      if (left.length > 0) {
        return {
          status: 'refused',
          reason: `The Harness has no Profile ${preview.profile} to remove, but its gate registry still names it for ${left.join(', ')}: nothing was freed, and the Project stays in the list.`,
          workflowFolder: null,
        }
      }
    }
    if (run.code !== 0 && !gone) {
      const heldFiles = folder !== null && folder.inside && existsSync(folder.path)
      return { status: 'refused', reason: `The Harness did not remove the Profile ${preview.profile}, so the Project stays in the list: ${messages.join('; ')}`, workflowFolder: heldFiles ? folder.path : null }
    }
    deps.projects.remove(project.id)
    const notes = notesOf(run)
    if (others.length > 0) {
      notes.push(`${others.map((other) => other.name).join(', ')} stay${others.length === 1 ? 's' : ''} in the list without a Profile: Remove from list takes ${others.length === 1 ? 'it' : 'them'} out, or Add project connects ${others.length === 1 ? 'its folder' : 'their folders'} again.`)
    }
    return { status: 'removed', notes }
  } catch (error) {
    return { status: 'refused', reason: messageOf(error), workflowFolder: null }
  } finally {
    release()
    await watchAgain().catch((error: unknown) => console.warn('[projects] watching a Project again after its removal failed', error))
  }
}

/** One removal of a Project at a time: a second call while one runs gets that one's answer. */
export class ProjectRemover {
  private readonly running = new Map<string, Promise<RemoveProjectResult>>()

  /** `deps` is asked on each removal, so building the remover does no I/O. */
  constructor(private readonly deps: () => Promise<ProjectRemovalDeps>) {}

  remove(id: string): Promise<RemoveProjectResult> {
    const current = this.running.get(id)
    if (current !== undefined) return current
    const started = this.deps()
      .then((deps) => removeProject(deps, id))
      .finally(() => this.running.delete(id))
    this.running.set(id, started)
    return started
  }
}
