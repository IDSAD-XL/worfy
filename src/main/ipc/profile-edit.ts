// Handlers of the `profileEdit` domain (src/shared/ipc/profile-edit.ts, worfy-polish ticket 78): "Edit
// profile" of Project settings. The Profile is read, checked and written only through the Harness's
// `bin/profile-set --field <name>…` (ADR-0073), with the fields of PROFILE_EDIT_FIELDS and nothing else:
// worfy never writes `profile.json` itself (ADR-0002, ADR-0005). `read` reads them with their fingerprint,
// and `mode` and `workflow.folder` beside them; `check` is `--check` of the form's values (the draft
// schema's rules, nothing written); `write` is `--set` with `--expect` of the fingerprint read, so a
// Profile changed since then is not written.
//
// `move` (worfy-polish ticket 81) moves the Project's workflow files between Full and Silent mode through
// `bin/profile-set --move` (the Harness checks the trees and the open PRs, moves and commits the files on both
// sides and writes `mode` and `workflow.folder`, rolling everything back on a failure). worfy adds the one
// refusal only it can tell: a Session of the Project at work. Its watches of the Project (Tickets, documents)
// close for the move and open again after it, as for a removal: Windows refuses to delete a folder a watch
// holds a handle inside. They open again where the files are now: the cached layout of the root is dropped,
// the Tickets watch reads the layout afresh, and the documents watch starts at the root `docsSource` names.
//
// A window of a Linked machine with full access calls these handlers through the link, as `ecoMode`
// does: the root it sends must be a Project of this Machine, and the Profile is written here.
import { resolve } from 'node:path'
import type { SessionState } from '../../shared/agent/events'
import { pipelineFingerprintSchema } from '../../shared/ipc/pipeline'
import {
  PROFILE_EDIT_FIELDS,
  PROFILE_FIXED_FIELDS,
  profileEditCheck,
  profileEditIssueSchema,
  profileEditMove,
  profileEditRead,
  profileEditWrite,
  type ProfileEditIssue,
  type ProfileEditRead,
  type ProfileEditValues,
  type ProfileEditWriteResult,
  type ProfileMoveResult,
} from '../../shared/ipc/profile-edit'
import { isInsidePath } from '../claude-home/registry'
import type { DocsHub, DocsRoot } from '../docs/watch'
import { harnessScriptEnv } from '../harness/script-env'
import { realInsideProjects } from '../link/caller'
import { realpathOrSelf } from '../projects/real-path'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { projectLayouts, type LayoutCache } from '../workflow/folder'
import { HarnessScriptStartError, scriptFailureDetail, type ProfileRun } from '../workflow/profile'
import type { WorkflowHub } from '../workflow/watch'
import { defineHandler, type HandlerModule } from './index'
import { PROFILE_SET_BUSY, PROFILE_SET_CONFLICT, profileSetRunner, type ProfileSetRunner } from './pipeline'

const fieldArgs = (fields: readonly string[]): string[] => fields.flatMap((field) => ['--field', field])
const EDIT_ARGS = fieldArgs(PROFILE_EDIT_FIELDS)

/** The reason "Edit profile" is not offered on a Harness whose `bin/profile-set` writes only some fields, or none. */
export const PROFILE_SET_TOO_OLD = "this Harness's bin/profile-set does not write these Profile fields; update the Harness"

/**
 * A run of `bin/profile-set`, or null when this Harness has none, or one older than `--field <any field>`:
 * that one refuses the name as a usage error (exit 2, "--field takes workflow.agents or agents", or
 * "unknown argument: --field" before it had --field), and knows no `--check`.
 */
async function runOrTooOld(run: ProfileSetRunner, args: readonly string[], stdin?: string): Promise<ProfileRun | null> {
  try {
    const done = await run(args, stdin)
    return done.code === 2 && /--field takes workflow\.agents or agents|unknown argument: --(?:field|check)/u.test(done.stderr) ? null : done
  } catch (error) {
    if (error instanceof HarnessScriptStartError && error.code === 'ENOENT') return null
    throw error
  }
}

/** The reason "Move" is refused on a Harness whose `bin/profile-set` has no `--move`. */
export const PROFILE_MOVE_TOO_OLD = "this Harness's bin/profile-set cannot move the workflow files; update the Harness"

/**
 * How long a move may take before worfy stops it: it lists the open PRs and copies and commits every workflow
 * file, thousands in a large project. A stopped move is rolled back by the next one (its marker beside the
 * Profile), so the limit only keeps a hung run from holding the watches closed for good.
 */
export const MOVE_TIMEOUT_MS = 30 * 60_000

/** The states of a Session at work: a move waits until it is idle, or closed. */
const AT_WORK: readonly SessionState[] = ['starting', 'busy', 'needs_permission']

/** Whether `path` is `root` or inside it, by either spelling of each (a link on the way spells it twice). */
function within(path: string, root: string): boolean {
  const spellings = (one: string): string[] => [...new Set([one, realpathOrSelf(one)])]
  return spellings(path).some((one) => spellings(root).some((other) => isInsidePath(one.normalize('NFC'), other.normalize('NFC'))))
}

/** Why a run failed, in a line: its exit code and what its stderr says. */
function failure(run: ProfileRun, what: string): Error {
  const how = run.code === null ? `stopped${run.signal ? ` by ${run.signal}` : ''}` : `exit ${run.code}`
  const detail = scriptFailureDetail(run.stderr)
  return new Error(`bin/profile-set ${what} failed (${how})${detail ? `: ${detail}` : ''}`)
}

/** The JSON object a run printed on stdout, or null. */
function jsonOf(stdout: string): Record<string, unknown> | null {
  try {
    const json: unknown = JSON.parse(stdout)
    return typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The fields of a `--read` answer, or a reason it is not one. */
function readFields(run: ProfileRun): { name: string; fields: ProfileEditValues; fingerprint: string } {
  const json = jsonOf(run.stdout)
  const fingerprint = pipelineFingerprintSchema.safeParse(json?.fingerprint)
  const fields = json?.fields
  if (json !== null && typeof json.name === 'string' && typeof fields === 'object' && fields !== null && !Array.isArray(fields) && fingerprint.success) {
    return { name: json.name, fields: fields as ProfileEditValues, fingerprint: fingerprint.data }
  }
  throw new Error(`bin/profile-set --read printed an unexpected answer: ${JSON.stringify(run.stdout.slice(0, 200))}`)
}

/** The message of a refusal, without the script's name. */
const reasonOf = (run: ProfileRun): string => scriptFailureDetail(run.stderr).replace(/^profile-set: /u, '') || 'bin/profile-set refused the change'

/** The problems of an exit 1: those its stdout names, else its stderr as one problem of the whole form. */
function issuesOf(run: ProfileRun): ProfileEditIssue[] {
  const errors = jsonOf(run.stdout)?.errors
  const parsed = profileEditIssueSchema.array().safeParse(errors)
  if (parsed.success && parsed.data.length > 0) return parsed.data
  return [{ path: '', message: reasonOf(run) }]
}

/** The value `--set` and `--check` take: exactly the fields of PROFILE_EDIT_FIELDS, a field the window left out is null. */
const valueOf = (values: ProfileEditValues): string => JSON.stringify(Object.fromEntries(PROFILE_EDIT_FIELDS.map((field) => [field, Object.hasOwn(values, field) ? values[field] : null])))

export interface ProfileEditHandlersOptions {
  projects?: () => readonly { readonly path: string }[]
  /** `bin/profile-set`; the app's (profileSetRunner) when absent. */
  profileSet?: ProfileSetRunner
  /** `bin/profile-set` for a move, with its longer time limit; the app's when absent. */
  profileMove?: ProfileSetRunner
  /** The live Sessions of the app (the Session registry's list); the app's when absent. */
  sessions?: () => Promise<readonly { readonly cwd: string; readonly state: SessionState }[]>
  /** Closes worfy's watches of the Project at `root` for a move; the returned function watches it again. The app's when absent. */
  holdWatches?: (root: string) => Promise<() => Promise<void>>
  /** The layouts of the Projects: how many repositories one has, and the entry a move makes stale. The app's cache when absent. */
  layouts?: Pick<LayoutCache, 'get' | 'forget'>
}

/** The app's live Sessions: the registry is imported on a move, not with this module. */
async function appSessions(): Promise<readonly { cwd: string; state: SessionState }[]> {
  const { sharedRegistry } = await import('../agent/app-registry')
  return sharedRegistry()
    .list()
    .map(({ cwd, state }) => ({ cwd, state }))
}

export interface ProjectWatches {
  workflowHub: Pick<WorkflowHub, 'hold'>
  docsHub: Pick<DocsHub, 'hold'>
  /** Where the documents of the Project at a root are now (src/main/ipc/docs.ts, docsSource). */
  docsSource: (root: string) => Promise<DocsRoot>
}

/**
 * Closes the Tickets watch of `root` (keyed by the folder) and the documents watch of each Project id in `ids`.
 * The returned function opens them again: the Tickets watch reads the layout afresh, the documents watch
 * starts at the root `docsSource` names then, so after a move it follows the files to their new place. A
 * `docsSource` that fails leaves the documents where they were watched.
 */
export async function holdProjectWatches(watches: ProjectWatches, root: string, ids: readonly string[]): Promise<() => Promise<void>> {
  const [tickets, ...documents] = await Promise.all([watches.workflowHub.hold(root), ...ids.map((id) => watches.docsHub.hold(id))])
  return async () => {
    const at = documents.length === 0 ? undefined : await watches.docsSource(root).catch(() => undefined)
    await Promise.all([tickets(), ...documents.map((watchAgain) => watchAgain(at))])
  }
}

/** The app's watches of the Project at `root`: its Tickets watch and the documents watch of each of its ids. */
async function appHoldWatches(root: string): Promise<() => Promise<void>> {
  const [{ workflowHub }, { docsHub, docsSource }] = await Promise.all([import('./workflow'), import('./docs')])
  const ids = projectStore()
    .list()
    .filter((project) => resolve(project.path) === resolve(root))
    .map((project) => project.id)
  return holdProjectWatches({ workflowHub, docsHub, docsSource: (at) => docsSource(at) }, root, ids)
}

/** The strings of a JSON array, none when it is not one. */
const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [])

/** The reasons of a refused move (exit 1): the problems its stdout names, else its stderr. */
const moveReasonOf = (run: ProfileRun): string =>
  issuesOf(run)
    .map((issue) => issue.message)
    .join('; ')

export function profileEditHandlers(options: ProfileEditHandlersOptions = {}): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const profileSet = options.profileSet ?? profileSetRunner(claudeHome(), harnessScriptEnv)
  const profileMove = options.profileMove ?? options.profileSet ?? profileSetRunner(claudeHome(), harnessScriptEnv, MOVE_TIMEOUT_MS)
  const sessions = options.sessions ?? appSessions
  const holdWatches = options.holdWatches ?? appHoldWatches
  const layouts = options.layouts ?? projectLayouts()
  /** The root as a Project of this Machine, or null: a window that shows a Linked machine sends that Machine's roots here. */
  const projectOf = (root: string): string | null => realInsideProjects(resolve(root), projects())
  const checkedRoot = (root: string, channel: string): string => {
    const checked = projectOf(root)
    if (checked === null) throw new Error(`${channel}: ${root} is not a Project of this Machine; a Profile is written on the Machine of its Project`)
    return checked
  }
  return [
    defineHandler(profileEditRead, async ({ root }): Promise<ProfileEditRead> => {
      const checked = projectOf(root)
      if (checked === null) return { available: false, reason: 'not a Project of this Machine' }
      const [edit, fixed] = await Promise.all([
        runOrTooOld(profileSet, ['-C', checked, ...EDIT_ARGS, '--read']),
        runOrTooOld(profileSet, ['-C', checked, ...fieldArgs(PROFILE_FIXED_FIELDS), '--read']),
      ])
      if (edit === null || fixed === null) return { available: false, reason: PROFILE_SET_TOO_OLD }
      if (edit.code !== 0) throw failure(edit, '--read')
      if (fixed.code !== 0) throw failure(fixed, '--read')
      const read = readFields(edit)
      const fixedRead = readFields(fixed)
      const repos = await layouts.get(checked).then((layout) => layout.repos.length, () => 0)
      return {
        available: true,
        name: read.name,
        values: read.fields,
        fixed: fixedRead.fields,
        fixedFingerprint: fixedRead.fingerprint,
        interrupted: jsonOf(fixed.stdout)?.interrupted === true,
        severalRepos: repos > 1,
        fingerprint: read.fingerprint,
      }
    }),
    defineHandler(profileEditCheck, async ({ root, values }): Promise<ProfileEditIssue[]> => {
      const checked = checkedRoot(root, 'profileEdit.check')
      const run = await runOrTooOld(profileSet, ['-C', checked, ...EDIT_ARGS, '--check', '-'], valueOf(values))
      if (run === null) return [{ path: '', message: PROFILE_SET_TOO_OLD }]
      if (run.code === 0) return []
      if (run.code === 1) return issuesOf(run)
      throw failure(run, '--check')
    }),
    defineHandler(profileEditWrite, async ({ root, values, expected }): Promise<ProfileEditWriteResult> => {
      const checked = checkedRoot(root, 'profileEdit.write')
      const run = await runOrTooOld(profileSet, ['-C', checked, ...EDIT_ARGS, '--expect', expected, '--set', '-'], valueOf(values))
      if (run === null) return { status: 'invalid', reason: PROFILE_SET_TOO_OLD, issues: [] }
      if (run.code === PROFILE_SET_CONFLICT) return { status: 'conflict' }
      if (run.code === PROFILE_SET_BUSY) return { status: 'busy' }
      if (run.code === 1) return { status: 'invalid', reason: reasonOf(run), issues: issuesOf(run) }
      if (run.code !== 0) throw failure(run, '--set')
      const json = jsonOf(run.stdout)
      const fingerprint = pipelineFingerprintSchema.safeParse(json?.fingerprint)
      if (!fingerprint.success) throw new Error(`bin/profile-set --set printed an unexpected answer: ${JSON.stringify(run.stdout.slice(0, 200))}`)
      return { status: 'saved', fingerprint: fingerprint.data, warning: typeof json?.warning === 'string' ? json.warning : null }
    }),
    defineHandler(profileEditMove, async ({ root, to, folder, expected }): Promise<ProfileMoveResult> => {
      const checked = checkedRoot(root, 'profileEdit.move')
      // The Workflow folder the files live in now (Silent mode): a Session working there is at work on them too.
      const fixedRun = await runOrTooOld(profileSet, ['-C', checked, ...fieldArgs(PROFILE_FIXED_FIELDS), '--read'])
      if (fixedRun === null) return { status: 'refused', reason: PROFILE_MOVE_TOO_OLD }
      if (fixedRun.code !== 0) throw failure(fixedRun, '--read')
      const current = readFields(fixedRun).fields['workflow.folder']
      const folders = [checked, ...(typeof current === 'string' ? [current] : []), ...(folder === null ? [] : [folder])]
      const working = (await sessions()).filter((session) => AT_WORK.includes(session.state) && folders.some((one) => within(session.cwd, one)))
      if (working.length > 0) {
        return { status: 'refused', reason: `a Session of the Project is at work (${working.length === 1 ? 'one Session' : `${working.length} Sessions`}): let it finish or close it, then move the files` }
      }
      const watchAgain = await holdWatches(checked)
      let run: ProfileRun
      try {
        run = await profileMove(['-C', checked, '--expect', expected, '--move', to, ...(folder === null ? [] : ['--folder', folder])])
      } finally {
        // Whatever the answer: a move stopped half-way or rolled back leaves the layout to be read again too.
        layouts.forget(checked)
        await watchAgain()
      }
      if (run.code === 2 && /unknown argument: --move/u.test(run.stderr)) return { status: 'refused', reason: PROFILE_MOVE_TOO_OLD }
      if (run.code === PROFILE_SET_CONFLICT) return { status: 'conflict' }
      if (run.code === PROFILE_SET_BUSY) return { status: 'busy' }
      if (run.code === 1) {
        const left = stringsOf(jsonOf(run.stdout)?.leftover)
        return left.length > 0 ? { status: 'failed', reason: moveReasonOf(run), left } : { status: 'refused', reason: moveReasonOf(run) }
      }
      if (run.code !== 0) throw failure(run, '--move')
      const json = jsonOf(run.stdout)
      const moved = json?.moved
      if (typeof moved !== 'object' || moved === null || Array.isArray(moved)) throw new Error(`bin/profile-set --move printed an unexpected answer: ${JSON.stringify(run.stdout.slice(0, 200))}`)
      const report = moved as Record<string, unknown>
      return {
        status: 'moved',
        mode: to,
        folder: typeof report.folder === 'string' ? report.folder : null,
        files: typeof report.files === 'number' ? report.files : 0,
        warning: typeof json?.warning === 'string' ? json.warning : null,
        ignored: stringsOf(report.ignored),
        recovered: report.recovered === 'finished' || report.recovered === 'rolled-back' ? report.recovered : null,
        qmd: stringsOf(report.qmd),
      }
    }),
  ]
}

export default profileEditHandlers()
