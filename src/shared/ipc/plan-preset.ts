// The `planPreset` domain (worfy-throughput ticket 42): the plan Claude Code is signed in with, and the
// preset of that plan for the active Project (src/shared/agent/plan-preset.ts). Settings → Plan reads
// it and offers the preset with an Apply button; nothing is written without the click. The write goes
// through the Harness's `bin/profile-set --field workflow.agents --field agents` (src/main/ipc/plan-preset.ts),
// never by worfy itself (ADR-0002, ADR-0005), and turns on this Machine's Autopilot budget with it.
// Both channels are `local`: the plan is this Machine's sign-in, and a Profile is written only by worfy
// on the Machine its Project lives on.
import { z } from 'zod'
import { PLANS } from '../agent/plan-preset'
import { absolutePathSchema } from '../paths'
import { invokeChannel } from './channels'
import { pipelineFingerprintSchema } from './pipeline'

/** The Profile's fields a preset writes, as `bin/profile-set --field … --read` gives them. */
export const planPresetProfileSchema = z.discriminatedUnion('available', [
  /** Not read: the Harness has no `bin/profile-set --field`, or the root is no Project of this Machine. */
  z.object({ available: z.literal(false), reason: z.string() }),
  z.object({
    available: z.literal(true),
    /** Each field as the file has it; null when absent. */
    fields: z.object({ 'workflow.agents': z.unknown(), agents: z.unknown() }),
    /** The fingerprint of the two fields together: the write goes ahead only while the Profile still has them. */
    fingerprint: pipelineFingerprintSchema,
  }),
])
export type PlanPresetProfile = z.infer<typeof planPresetProfileSchema>

export const planPresetReadSchema = z.object({
  /** `accountInfo().subscriptionType` as Claude Code answered it; null when not signed in or not known. */
  subscriptionType: z.string().nullable(),
  /** Why the plan is not known: Claude Code did not answer. Null when it answered. */
  planError: z.string().nullable(),
  /** The Profile's fields; null when the plan has no preset, so nothing was read. */
  profile: planPresetProfileSchema.nullable(),
})
export type PlanPresetRead = z.infer<typeof planPresetReadSchema>

const projectRoot = z.object({ root: absolutePathSchema })

/**
 * The plan and, when it has a preset, the Profile's fields of the Project at `root`. The plan is the one
 * the latest Session reported; with none yet, main asks a Claude Code process once, as the first-run
 * check does. Writes nothing.
 */
export const planPresetRead = invokeChannel('planPreset.read', projectRoot, planPresetReadSchema, 'local')

export const planPresetApplyInputSchema = z.object({
  root: absolutePathSchema,
  /** The plan whose preset is applied; main takes the values from its own table, not from the window. */
  plan: z.enum(PLANS),
  /** The fingerprint `planPreset.read` gave. */
  expected: pipelineFingerprintSchema,
})

export const planPresetApplyResultSchema = z.discriminatedUnion('status', [
  /** Written, and the budget turned on. `warning`: why the change was not committed in the Harness home's git; the write stays. */
  z.object({ status: z.literal('saved'), warning: z.string().nullable() }),
  /** The Profile's fields are not the ones read: nothing written. */
  z.object({ status: z.literal('conflict') }),
  /** Another write of the same Profile held its lock for the whole wait: nothing written, try again. */
  z.object({ status: z.literal('busy') }),
  /** `bin/profile-set` refused the value (exit 1) with this reason: nothing written. */
  z.object({ status: z.literal('invalid'), reason: z.string() }),
  /** The Harness has no `bin/profile-set --field`: nothing written. */
  z.object({ status: z.literal('too-old') }),
])
export type PlanPresetApplyResult = z.infer<typeof planPresetApplyResultSchema>

/** Applies the preset of `plan` to the Project's Profile and turns on this Machine's Autopilot budget: the click of Apply. */
export const planPresetApply = invokeChannel('planPreset.apply', planPresetApplyInputSchema, planPresetApplyResultSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'planPreset.read': typeof planPresetRead
    'planPreset.apply': typeof planPresetApply
  }
}
