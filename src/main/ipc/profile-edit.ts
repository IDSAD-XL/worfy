// Handlers of the `profileEdit` domain (src/shared/ipc/profile-edit.ts, worfy-polish ticket 78): "Edit
// profile" of Project settings. The Profile is read, checked and written only through the Harness's
// `bin/profile-set --field <name>…` (ADR-0073), with the fields of PROFILE_EDIT_FIELDS and nothing else:
// worfy never writes `profile.json` itself (ADR-0002, ADR-0005). `read` reads them with their fingerprint,
// and `mode` and `workflow.folder` beside them; `check` is `--check` of the form's values (the draft
// schema's rules, nothing written); `write` is `--set` with `--expect` of the fingerprint read, so a
// Profile changed since then is not written.
//
// A window of a Linked machine with full access calls these handlers through the link, as `ecoMode`
// does: the root it sends must be a Project of this Machine, and the Profile is written here.
import { resolve } from 'node:path'
import { pipelineFingerprintSchema } from '../../shared/ipc/pipeline'
import {
  PROFILE_EDIT_FIELDS,
  PROFILE_FIXED_FIELDS,
  profileEditCheck,
  profileEditIssueSchema,
  profileEditRead,
  profileEditWrite,
  type ProfileEditIssue,
  type ProfileEditRead,
  type ProfileEditValues,
  type ProfileEditWriteResult,
} from '../../shared/ipc/profile-edit'
import { harnessScriptEnv } from '../harness/script-env'
import { realInsideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { HarnessScriptStartError, scriptFailureDetail, type ProfileRun } from '../workflow/profile'
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
}

export function profileEditHandlers(options: ProfileEditHandlersOptions = {}): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const profileSet = options.profileSet ?? profileSetRunner(claudeHome(), harnessScriptEnv)
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
      return { available: true, name: read.name, values: read.fields, fixed: readFields(fixed).fields, fingerprint: read.fingerprint }
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
  ]
}

export default profileEditHandlers()
