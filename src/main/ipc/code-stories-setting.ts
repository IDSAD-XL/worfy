// Handlers of the `codeStoriesSetting` domain (src/shared/ipc/code-stories-setting.ts, worfy-code-stories
// ticket 03): the switch "Code stories for PRs" of Project settings. The Profile field `code_stories.pr` is read
// and written only through the Harness's `bin/profile-set --field code_stories.pr` (ADR-0073), as the Eco mode
// switch does (src/main/ipc/eco-mode.ts): worfy never writes the Profile itself (ADR-0002, ADR-0005).
//
// On writes "on", off writes "off"; absent or null reads as on, as `bin/profile` resolves it. Each write carries
// `--expect` with the fingerprint the window read: a Profile changed in between is not written. A window of a
// Linked machine with full access calls these handlers through the link: the root it sends must be a Project of
// this Machine, and the Profile is written here.
import { resolve } from 'node:path'
import {
  codeStoriesSettingRead,
  codeStoriesSettingSet,
  type CodeStoriesSettingSetResult,
  type CodeStoriesSettingState,
} from '../../shared/ipc/code-stories-setting'
import { pipelineFingerprintSchema } from '../../shared/ipc/pipeline'
import { realInsideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { harnessScriptEnv } from '../harness/script-env'
import { HarnessScriptStartError, scriptFailureDetail, type ProfileRun } from '../workflow/profile'
import { defineHandler, type HandlerModule } from './index'
import { PROFILE_SET_BUSY, PROFILE_SET_CONFLICT, profileSetRunner, type ProfileSetRunner } from './pipeline'

const FIELD = 'code_stories.pr'

/** A run of `bin/profile-set --field`, or null when this Harness has none or an older one without `--field`. */
async function runOrTooOld(run: ProfileSetRunner, args: readonly string[]): Promise<ProfileRun | null> {
  try {
    const done = await run(args)
    // A profile-set older than --field refuses it as a usage error (exit 2, "unknown argument: --field").
    return done.code === 2 && /unknown argument: --field/u.test(done.stderr) ? null : done
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

interface Answer {
  fingerprint: string
  /** The fields of `--read`; undefined in the answer of a write. */
  fields: Record<string, unknown> | undefined
  /** Why a write was not committed in the Harness home's git; null when it was, or for `--read`. */
  warning: string | null
}

/** A run's JSON answer, or an error that names what was printed. */
function answerOf(stdout: string, what: string): Answer {
  try {
    const json = JSON.parse(stdout) as Record<string, unknown>
    const fingerprint = pipelineFingerprintSchema.safeParse(json.fingerprint)
    const fields = json.fields !== null && typeof json.fields === 'object' ? (json.fields as Record<string, unknown>) : undefined
    const warning = typeof json.warning === 'string' ? json.warning : null
    if (fingerprint.success) return { fingerprint: fingerprint.data, fields, warning }
  } catch {
    // Falls through to the error below.
  }
  throw new Error(`bin/profile-set ${what} printed an unexpected answer: ${JSON.stringify(stdout.slice(0, 200))}`)
}

export interface CodeStoriesSettingHandlersOptions {
  projects?: () => readonly { readonly path: string }[]
  /** `bin/profile-set`; the app's (profileSetRunner) when absent. */
  profileSet?: ProfileSetRunner
}

export function codeStoriesSettingHandlers(options: CodeStoriesSettingHandlersOptions = {}): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const profileSet = options.profileSet ?? profileSetRunner(claudeHome(), harnessScriptEnv)
  /** The root as a Project of this Machine, or null: a window that shows a Linked machine sends that Machine's roots here. */
  const projectOf = (root: string): string | null => realInsideProjects(resolve(root), projects())
  return [
    defineHandler(codeStoriesSettingRead, async ({ root }): Promise<CodeStoriesSettingState> => {
      const checked = projectOf(root)
      if (checked === null) return { available: false, reason: 'not a Project of this Machine' }
      const run = await runOrTooOld(profileSet, ['-C', checked, '--field', FIELD, '--read'])
      if (run === null) return { available: false, reason: 'this Harness has no bin/profile-set --field' }
      if (run.code !== 0) throw failure(run, '--read')
      const { fingerprint, fields } = answerOf(run.stdout, '--read')
      if (fields === undefined) throw new Error(`bin/profile-set --read printed an unexpected answer: ${JSON.stringify(run.stdout.slice(0, 200))}`)
      return { available: true, on: fields[FIELD] !== 'off', fingerprint }
    }),
    defineHandler(codeStoriesSettingSet, async ({ root, on, expected }): Promise<CodeStoriesSettingSetResult> => {
      const checked = projectOf(root)
      if (checked === null) throw new Error(`codeStoriesSetting.set: ${root} is not a Project of this Machine; a Profile is written on the Machine of its Project`)
      const value = JSON.stringify({ [FIELD]: on ? 'on' : 'off' })
      const run = await runOrTooOld(profileSet, ['-C', checked, '--field', FIELD, '--expect', expected, '--set', value])
      if (run === null) return { status: 'too-old' }
      if (run.code === PROFILE_SET_CONFLICT) return { status: 'conflict' }
      if (run.code === PROFILE_SET_BUSY) return { status: 'busy' }
      if (run.code === 1) return { status: 'invalid', reason: scriptFailureDetail(run.stderr).replace(/^profile-set: /u, '') || 'bin/profile-set refused the change' }
      if (run.code !== 0) throw failure(run, '--set')
      const { fingerprint, warning } = answerOf(run.stdout, '--set')
      return { status: 'saved', on, fingerprint, warning }
    }),
  ]
}

export default codeStoriesSettingHandlers()
