// The `ecoMode` domain (worfy-throughput ticket 60): the Eco mode switch in the bar under the
// Orchestrator's input field (src/renderer/session/composer/EcoMode.tsx). On writes the eco set of the
// Pro preset (`PLAN_PRESETS.pro.profile` of src/shared/agent/plan-preset.ts: `workflow.agents: "eco"`
// and Sonnet with effort medium for every agent role) to the Project's Profile; off removes both
// fields, so the Project gets the Harness's defaults again. The write goes through the Harness's
// `bin/profile-set --field workflow.agents --field agents` (src/main/ipc/eco-mode.ts), never by worfy
// itself (ADR-0002, ADR-0005), and takes effect from the next Ticket handed out.
// Both channels are `local`: a Profile is written only by worfy on the Machine its Project lives on.
import { z } from 'zod'
import { absolutePathSchema } from '../paths'
import { invokeChannel } from './channels'
import { pipelineFingerprintSchema } from './pipeline'

/** What the switch shows for a Project. */
export const ecoModeStateSchema = z.discriminatedUnion('available', [
  /** Not read: the Harness has no `bin/profile-set --field`, or the root is no Project of this Machine. */
  z.object({ available: z.literal(false), reason: z.string() }),
  z.object({
    available: z.literal(true),
    /** `workflow.agents` of the Profile is "eco"; `agents` is not looked at. */
    on: z.boolean(),
    /** The fingerprint of the two fields together: a write goes ahead only while the Profile still has them. */
    fingerprint: pipelineFingerprintSchema,
  }),
])
export type EcoModeState = z.infer<typeof ecoModeStateSchema>

/** The switch's state for the Project at `root`. Writes nothing. */
export const ecoModeRead = invokeChannel('ecoMode.read', z.object({ root: absolutePathSchema }), ecoModeStateSchema, 'local')

export const ecoModeSetInputSchema = z.object({
  root: absolutePathSchema,
  /** true writes the eco set; false removes `workflow.agents` and `agents`. */
  on: z.boolean(),
  /** The fingerprint `ecoMode.read` (or the last write) gave. */
  expected: pipelineFingerprintSchema,
})

export const ecoModeSetResultSchema = z.discriminatedUnion('status', [
  /** Written. `warning`: why the change was not committed in the Harness home's git; the write stays. */
  z.object({ status: z.literal('saved'), on: z.boolean(), fingerprint: pipelineFingerprintSchema, warning: z.string().nullable() }),
  /** The Profile's fields are not the ones read: nothing written; read again. */
  z.object({ status: z.literal('conflict') }),
  /** Another write of the same Profile held its lock for the whole wait: nothing written, try again. */
  z.object({ status: z.literal('busy') }),
  /** `bin/profile-set` refused the value (exit 1) with this reason: nothing written. */
  z.object({ status: z.literal('invalid'), reason: z.string() }),
  /** The Harness has no `bin/profile-set --field`: nothing written. */
  z.object({ status: z.literal('too-old') }),
])
export type EcoModeSetResult = z.infer<typeof ecoModeSetResultSchema>

/** Turns Eco mode on or off for the Project at `root`: the click of the switch. */
export const ecoModeSet = invokeChannel('ecoMode.set', ecoModeSetInputSchema, ecoModeSetResultSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'ecoMode.read': typeof ecoModeRead
    'ecoMode.set': typeof ecoModeSet
  }
}
