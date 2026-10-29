// Handlers of the `planPreset` domain (src/shared/ipc/plan-preset.ts, worfy-throughput ticket 42): the
// plan Claude Code is signed in with, and the preset of that plan written to a Project's Profile.
//
// The plan is the `subscriptionType` of the latest `account` event of any Session of the app
// (src/main/agent/session.ts); with none yet, a Claude Code process is asked, as the first-run sign-in
// check asks it (src/main/ipc/first-run.ts), and a plan it names is kept for the app's life. Only the
// Plan section of Settings reads it, and only while it is the section shown. An ask still in flight
// when the app quits is stopped: its Claude Code process is closed then, not at the ask's timeout.
//
// The Profile is read and written only through the Harness's `bin/profile-set --field workflow.agents
// --field agents` (ADR-0073): worfy never writes it itself (ADR-0002, ADR-0005). `planPreset.read`
// only reads; `planPreset.apply` — the click of Apply — writes the preset from the table in
// src/shared/agent/plan-preset.ts, then turns on the Autopilot budget of this Machine.
import { resolve } from 'node:path'
import { app } from 'electron'
import type { AgentEvent } from '../../shared/agent/events'
import { PLAN_PRESETS, planOf, presetFor } from '../../shared/agent/plan-preset'
import { planPresetApply, planPresetRead, type PlanPresetApplyResult, type PlanPresetProfile, type PlanPresetRead } from '../../shared/ipc/plan-preset'
import type { AppSettingsPatch } from '../../shared/settings/app-settings'
import { sharedRegistry } from '../agent/app-registry'
import type { AccountInfoLike } from '../agent/session'
import type { EventSink } from '../agent/session/types'
import { realInsideProjects } from '../link/caller'
import { projectStore } from '../projects/store'
import { appSettingsStore } from '../settings/store'
import { claudeHome } from '../storage/paths'
import { harnessScriptEnv } from '../harness/script-env'
import { HarnessScriptStartError, scriptFailureDetail, type ProfileRun } from '../workflow/profile'
import { askSignedInAccount } from './first-run'
import { defineHandler, type HandlerModule } from './index'
import { PROFILE_SET_BUSY, PROFILE_SET_CONFLICT, profileSetRunner, type ProfileSetRunner } from './pipeline'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The plan of this Machine's sign-in: what the latest Session reported, else an answer of Claude Code. */
export class PlanSource {
  /** The plan last named; null while none is (no Session reported one, or one reported no sign-in). */
  private known: string | null = null
  private asking: Promise<string | null> | null = null
  /** Stops the ask in flight; aborted for good by stop(). */
  private readonly stopping = new AbortController()

  /** `ask` must close its Claude Code process when `signal` aborts (askAccount does). */
  constructor(private readonly ask: (signal: AbortSignal) => Promise<AccountInfoLike>) {}

  /** Every Session event of the app comes here; an `account` event sets the plan, or forgets it when it names none. */
  readonly note: EventSink = (_sessionId, event: AgentEvent) => {
    if (event.type === 'account') this.known = event.subscriptionType
  }

  /**
   * The plan; asks Claude Code when none is known. Two reads at a time share one ask. An answer
   * without a plan and a failed ask are not kept: the next read asks again.
   */
  async get(): Promise<{ subscriptionType: string | null; error: string | null }> {
    if (this.known !== null) return { subscriptionType: this.known, error: null }
    if (this.stopping.signal.aborted) return { subscriptionType: null, error: 'worfy is quitting' }
    this.asking ??= this.ask(this.stopping.signal)
      .then((info) => {
        // A Session that reported while the process was asked is newer: it stays.
        this.known ??= info.subscriptionType ?? null
        return this.known
      })
      .finally(() => {
        this.asking = null
      })
    try {
      return { subscriptionType: await this.asking, error: null }
    } catch (error) {
      return { subscriptionType: null, error: messageOf(error) }
    }
  }

  /** The app quits: the ask in flight, if any, closes its Claude Code process now, and no new one starts. */
  stop(): void {
    this.stopping.abort()
  }
}

const FIELDS = ['--field', 'workflow.agents', '--field', 'agents']

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

/** What `bin/profile-set --field … --read` printed, or a reason it is not that. */
function readOf(stdout: string): PlanPresetProfile {
  try {
    const json = JSON.parse(stdout) as { fields?: Record<string, unknown>; fingerprint?: unknown }
    if (json.fields !== undefined && typeof json.fingerprint === 'string' && /^sha256:[0-9a-f]{64}$/u.test(json.fingerprint)) {
      return { available: true, fields: { 'workflow.agents': json.fields['workflow.agents'] ?? null, agents: json.fields.agents ?? null }, fingerprint: json.fingerprint }
    }
  } catch {
    // Falls through to the reason below.
  }
  throw new Error(`bin/profile-set --read printed an unexpected answer: ${JSON.stringify(stdout.slice(0, 200))}`)
}

export interface PlanPresetHandlersOptions {
  plan: Pick<PlanSource, 'get'>
  projects?: () => readonly { readonly path: string }[]
  /** `bin/profile-set`; the app's (profileSetRunner) when absent. */
  profileSet?: ProfileSetRunner
  /** Changes this Machine's app settings; the app's store when absent. */
  setAppSettings?: (patch: AppSettingsPatch) => void
}

export function planPresetHandlers(options: PlanPresetHandlersOptions): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const profileSet = options.profileSet ?? profileSetRunner(claudeHome(), harnessScriptEnv)
  const setAppSettings = options.setAppSettings ?? ((patch) => void appSettingsStore().set(patch))
  /** The root as a Project of this Machine, or null: a window that shows a Linked machine sends that Machine's roots here. */
  const projectOf = (root: string): string | null => realInsideProjects(resolve(root), projects())
  return [
    defineHandler(planPresetRead, async ({ root }): Promise<PlanPresetRead> => {
      const plan = await options.plan.get()
      if (presetFor(plan.subscriptionType) === null) return { subscriptionType: plan.subscriptionType, planError: plan.error, profile: null }
      const checked = projectOf(root)
      if (checked === null) return { subscriptionType: plan.subscriptionType, planError: null, profile: { available: false, reason: 'not a Project of this Machine' } }
      const run = await runOrTooOld(profileSet, ['-C', checked, ...FIELDS, '--read'])
      if (run === null) return { subscriptionType: plan.subscriptionType, planError: null, profile: { available: false, reason: 'this Harness has no bin/profile-set --field' } }
      if (run.code !== 0) throw failure(run, '--read')
      return { subscriptionType: plan.subscriptionType, planError: null, profile: readOf(run.stdout) }
    }),
    defineHandler(planPresetApply, async ({ root, plan, expected }): Promise<PlanPresetApplyResult> => {
      const preset = PLAN_PRESETS[plan]
      if (preset === undefined) throw new Error(`planPreset.apply: the plan ${plan} has no preset`)
      // The plan is main's, not the window's: a window that read before the sign-in changed gets no preset of the old plan.
      const now = await options.plan.get()
      if (planOf(now.subscriptionType) !== plan) {
        throw new Error(`planPreset.apply: Claude Code is signed in with ${now.subscriptionType ?? 'no known plan'} now, not ${preset.label}; read the plan again`)
      }
      const checked = projectOf(root)
      if (checked === null) throw new Error(`planPreset.apply: ${root} is not a Project of this Machine; a Profile is written on the Machine of its Project`)
      const run = await runOrTooOld(profileSet, ['-C', checked, ...FIELDS, '--expect', expected, '--set', '-'], JSON.stringify(preset.profile))
      if (run === null) return { status: 'too-old' }
      if (run.code === PROFILE_SET_CONFLICT) return { status: 'conflict' }
      if (run.code === PROFILE_SET_BUSY) return { status: 'busy' }
      if (run.code === 1) return { status: 'invalid', reason: scriptFailureDetail(run.stderr).replace(/^profile-set: /u, '') || 'bin/profile-set refused the preset' }
      if (run.code !== 0) throw failure(run, '--set')
      let warning: string | null = null
      try {
        warning = (JSON.parse(run.stdout) as { warning?: string | null }).warning ?? null
      } catch {
        // The write is done (exit 0); an answer that does not read leaves only the warning out.
      }
      // The budget only after the Profile is written: a refused preset changes nothing.
      setAppSettings({ autopilotBudget: preset.autopilotBudget })
      return { status: 'saved', warning }
    }),
  ]
}

/** The app's plan: every Session's events feed it from the time the IPC handlers are registered; an ask in flight stops when the app quits. */
function appPlan(): PlanSource {
  const plan = new PlanSource(askSignedInAccount)
  sharedRegistry().observe(plan.note)
  app.on('will-quit', () => plan.stop())
  return plan
}

export default planPresetHandlers({ plan: appPlan() })
