// Handlers of the `ecoMode` domain (src/shared/ipc/eco-mode.ts, worfy-throughput ticket 60): the Eco
// mode switch of the Orchestrator's input field. The Profile is read and written only through the
// Harness's `bin/profile-set --field workflow.agents --field agents` (ADR-0073), as Settings → Plan
// does (src/main/ipc/plan-preset.ts): worfy never writes it itself (ADR-0002, ADR-0005).
//
// On writes the eco set of the Pro preset (`PLAN_PRESETS.pro.profile`) on any plan, without the
// Autopilot budget: that is this Machine's setting, not the Project's. Off removes both fields
// (`--reset`); the models the roles had before are not kept. Each write carries `--expect` with the
// fingerprint the window read: a Profile changed in between is not written.
import { resolve } from 'node:path'
import { PLAN_PRESETS } from '../../shared/agent/plan-preset'
import { ecoModeRead, ecoModeSet, type EcoModeSetResult, type EcoModeState } from '../../shared/ipc/eco-mode'
import { pipelineFingerprintSchema } from '../../shared/ipc/pipeline'
import { realInsideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { harnessScriptEnv } from '../harness/script-env'
import { HarnessScriptStartError, scriptFailureDetail, type ProfileRun } from '../workflow/profile'
import { defineHandler, type HandlerModule } from './index'
import { PROFILE_SET_BUSY, PROFILE_SET_CONFLICT, profileSetRunner, type ProfileSetRunner } from './pipeline'

const FIELDS = ['--field', 'workflow.agents', '--field', 'agents']

/** The value of `workflow.agents` that means Eco mode is on. */
const ECO = 'eco'

/** The fields On writes: the Pro preset's, not a copy of its values. */
function ecoFields(): string {
  const pro = PLAN_PRESETS.pro
  if (pro === undefined) throw new Error('ecoMode.set: the Pro preset is missing, so there is no eco set to write')
  return JSON.stringify(pro.profile)
}

/** A run of `bin/profile-set --field`, or null when this Harness has none or an older one without `--field`. */
async function runOrTooOld(run: ProfileSetRunner, args: readonly string[], stdin?: string): Promise<ProfileRun | null> {
  try {
    const done = await run(args, stdin)
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

/** The JSON a run printed on stdout, or a reason it is not the answer `what` expects. */
function answerOf<T>(stdout: string, what: string, pick: (json: Record<string, unknown>) => T | undefined): T {
  try {
    const picked = pick(JSON.parse(stdout) as Record<string, unknown>)
    if (picked !== undefined) return picked
  } catch {
    // Falls through to the reason below.
  }
  throw new Error(`bin/profile-set ${what} printed an unexpected answer: ${JSON.stringify(stdout.slice(0, 200))}`)
}

const fingerprintOf = (value: unknown): string | undefined => {
  const parsed = pipelineFingerprintSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export interface EcoModeHandlersOptions {
  projects?: () => readonly { readonly path: string }[]
  /** `bin/profile-set`; the app's (profileSetRunner) when absent. */
  profileSet?: ProfileSetRunner
}

export function ecoModeHandlers(options: EcoModeHandlersOptions = {}): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const profileSet = options.profileSet ?? profileSetRunner(claudeHome(), harnessScriptEnv)
  /** The root as a Project of this Machine, or null: a window that shows a Linked machine sends that Machine's roots here. */
  const projectOf = (root: string): string | null => realInsideProjects(resolve(root), projects())
  return [
    defineHandler(ecoModeRead, async ({ root }): Promise<EcoModeState> => {
      const checked = projectOf(root)
      if (checked === null) return { available: false, reason: 'not a Project of this Machine' }
      const run = await runOrTooOld(profileSet, ['-C', checked, ...FIELDS, '--read'])
      if (run === null) return { available: false, reason: 'this Harness has no bin/profile-set --field' }
      if (run.code !== 0) throw failure(run, '--read')
      return answerOf(run.stdout, '--read', (json) => {
        const fields = json.fields as Record<string, unknown> | undefined
        const fingerprint = fingerprintOf(json.fingerprint)
        return fields === undefined || fingerprint === undefined ? undefined : { available: true, on: fields['workflow.agents'] === ECO, fingerprint }
      })
    }),
    defineHandler(ecoModeSet, async ({ root, on, expected }): Promise<EcoModeSetResult> => {
      const checked = projectOf(root)
      if (checked === null) throw new Error(`ecoMode.set: ${root} is not a Project of this Machine; a Profile is written on the Machine of its Project`)
      const run = on
        ? await runOrTooOld(profileSet, ['-C', checked, ...FIELDS, '--expect', expected, '--set', '-'], ecoFields())
        : await runOrTooOld(profileSet, ['-C', checked, ...FIELDS, '--expect', expected, '--reset'])
      if (run === null) return { status: 'too-old' }
      if (run.code === PROFILE_SET_CONFLICT) return { status: 'conflict' }
      if (run.code === PROFILE_SET_BUSY) return { status: 'busy' }
      if (run.code === 1) return { status: 'invalid', reason: scriptFailureDetail(run.stderr).replace(/^profile-set: /u, '') || 'bin/profile-set refused the change' }
      const what = on ? '--set' : '--reset'
      if (run.code !== 0) throw failure(run, what)
      return answerOf(run.stdout, what, (json) => {
        const fingerprint = fingerprintOf(json.fingerprint)
        const warning = typeof json.warning === 'string' ? json.warning : null
        return fingerprint === undefined ? undefined : { status: 'saved', on, fingerprint, warning }
      })
    }),
  ]
}

export default ecoModeHandlers()
