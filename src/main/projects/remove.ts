// "Remove project…" (worfy-polish ticket 79): the Project leaves this Machine's Harness, not only
// worfy's list, so its folders can be connected again ("Remove from list" keeps the Harness as it is,
// and its gate registry entries keep the paths taken: project-connect refuses a path already there).
//
// The Harness does the removal itself (ADR-0002: worfy changes the workflow only through its tools):
// `bin/project-connect --remove <profile>` deletes <Harness home>/projects/<profile>/ (with the default
// Workflow folder of a Silent mode Profile, only while that folder is empty), every gate registry
// entry of the Profile, <Harness home>/runs/<profile>/ and the qmd collections no other Profile names,
// in one commit, rolled back on a failure. It never touches a repository, nor a Workflow folder the
// user chose outside the Profile folder; it refuses a default Workflow folder that holds the
// project's own files, and nothing is removed then. worfy deletes nothing itself.
//
// The order (the ticket's section on what to do):
//   1. the preview: the Profile of the Project's folder (`bin/profile -C <folder> --dir`), and its gate
//      registry entries, which must all be the folder or inside it — a Profile that also covers paths
//      outside it (the folder is one repository of a Project over several) is refused, since removing
//      it would take the others with it;
//   2. a default Workflow folder that holds files is refused here, before anything closes;
//   3. the Project's Orchestrator stops and stays closed, and every Session whose folder is inside the
//      Project's is closed and waited for;
//   4. `project-connect --remove <profile>`; a refusal or a failure leaves the Project in the list, with
//      the script's words;
//   5. the Project leaves worfy's list (its data folder stays, as with "Remove from list").
//
// Everything that reaches outside comes in through ProjectRemovalDeps (src/main/ipc/projects.ts wires
// the app's), so the contract test runs it over a temporary Harness home.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { RemovalPreview } from '../../shared/ipc/projects'
import { isInsidePath } from '../claude-home/registry'
import type { ConnectScript, ScriptRun } from './connect'
import { realpathOrSelf } from './real-path'

export interface ProjectRemovalDeps {
  projects: {
    get(id: string): { id: string; name: string; path: string }
    /** Takes the Project out of the list, as `projects.remove` does (its Layout written and forgotten). */
    remove(id: string): void
  }
  /** The Profile folder of the folder: `bin/profile -C <folder> --dir`; throws with the reason when there is none. */
  profileDir: (root: string) => Promise<string>
  /** The `match` paths of the gate registry entries of a Profile. */
  registeredRepos: (profile: string) => Promise<readonly string[]>
  /** `bin/project-connect` of the Harness on the machine. */
  connect: ConnectScript
  /** Stops the Project's Orchestrator and keeps it closed; the returned function lets go. */
  stopOrchestrator: (projectId: string) => () => void
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

/** The Workflow folder of a Silent mode Profile, as project-connect places it; null in Full mode. */
function workflowFolderOf(profile: Record<string, unknown>, profileDir: string): { path: string; inside: boolean; holdsFiles: boolean } | null {
  if (profile.mode !== 'silent') return null
  const folder = isObject(profile.workflow) ? profile.workflow.folder : null
  const own = join(profileDir, 'workflow')
  const inside = typeof folder !== 'string' || resolve(folder) === own
  const path = inside ? own : folder
  let holdsFiles = false
  try {
    holdsFiles = existsSync(path) && readdirSync(path).some((entry) => entry !== '.git')
  } catch {
    // Not readable: the Harness decides, and says why it refuses.
  }
  return { path, inside, holdsFiles }
}

/** What "Remove project…" would remove for the Project `id`, or why it cannot. Never throws. */
export async function removalPreview(deps: Pick<ProjectRemovalDeps, 'projects' | 'profileDir' | 'registeredRepos'>, id: string): Promise<RemovalPreview> {
  try {
    const project = deps.projects.get(id)
    let profileDir: string
    try {
      profileDir = await deps.profileDir(project.path)
    } catch (error) {
      return { status: 'refused', reason: `The Harness of this Machine has no Profile for ${project.path}: ${messageOf(error)}. "Remove from list" is all there is to do.` }
    }
    const profile = basename(profileDir)
    const paths = [...(await deps.registeredRepos(profile))]
    if (paths.length === 0) {
      return { status: 'refused', reason: `The gate registry of this Machine has no entry of the Profile ${profile}, so there is no path to free. "Remove from list" is all there is to do.` }
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
      runs: join(dirname(dirname(profileDir)), 'runs', profile),
      qmd,
      mode: stored.mode === 'silent' ? 'silent' : 'full',
      workflowFolder: workflowFolderOf(stored, profileDir),
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

/** What the Harness says beside a removal that held: qmd skipped or failed, folders left behind. */
function notesOf(run: ScriptRun): string[] {
  try {
    const removed = (JSON.parse(run.stdout) as { removed?: { qmd?: { status?: string; reason?: string | null }; leftover?: string[] } }).removed
    const notes: string[] = []
    const qmd = removed?.qmd
    // A skip (no qmd, no collections) has nothing to say; a failure or a collection kept for another Profile has.
    if (qmd?.reason && qmd.status !== 'skipped') notes.push(`qmd collections: ${qmd.reason}`)
    for (const left of removed?.leftover ?? []) notes.push(`the Harness kept ${left}; delete it by hand once you no longer need it`)
    return notes
  } catch {
    return []
  }
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
      reason: `The Workflow folder ${folder.path} holds the project's own files (its tickets). worfy does not delete them: move the folder out of ${preview.profileDir} first. Nothing was removed.`,
      workflowFolder: folder.path,
    }
  }
  let project: { id: string; path: string }
  try {
    project = deps.projects.get(id)
  } catch (error) {
    return { status: 'refused', reason: messageOf(error), workflowFolder: null }
  }
  const release = deps.stopOrchestrator(project.id)
  try {
    await closeInside(deps, project.path)
    let run: ScriptRun
    try {
      run = await deps.connect(['--remove', preview.profile], '')
    } catch (error) {
      return { status: 'refused', reason: `The Harness could not be run: ${messageOf(error)}. The Project stays in the list.`, workflowFolder: null }
    }
    if (run.code === 2) return { status: 'refused', reason: UPDATE_HARNESS, workflowFolder: null }
    const messages = run.code === 0 ? [] : scriptMessages(run)
    // A Profile already gone is no failure: its paths are free, the list is all that is left.
    const gone = messages.length > 0 && messages.every((message) => message.startsWith(`no profile ${preview.profile}`))
    if (run.code !== 0 && !gone) {
      const heldFiles = folder !== null && folder.inside && existsSync(folder.path)
      return { status: 'refused', reason: `The Harness did not remove the Profile ${preview.profile}, so the Project stays in the list: ${messages.join('; ')}`, workflowFolder: heldFiles ? folder.path : null }
    }
    deps.projects.remove(project.id)
    return { status: 'removed', notes: notesOf(run) }
  } catch (error) {
    return { status: 'refused', reason: messageOf(error), workflowFolder: null }
  } finally {
    release()
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
