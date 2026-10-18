// The `gateQueue` domain (worfy-windows ticket 17): the cross-machine gate queue of a Project as this
// Machine sees it — its role from the Profile's cross_machine_gate, the label, and the labelled PRs
// that wait for the machine with `serve` (src/main/github/gate-queue.ts). Read-only: "Process gate
// queue" is an action (`actions.gateQueue`), and the skill does the work in a Session.
import { z } from 'zod'
import { invokeChannel } from './channels'

/** How the read of gh went: `ok`; `failed` with gh's reason; `skipped` — no queue on this Machine, gh not called. */
export const gateQueueGhSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok') }),
  z.object({ state: z.literal('failed'), reason: z.string() }),
  z.object({ state: z.literal('skipped'), reason: z.string() }),
])
export type GateQueueGh = z.infer<typeof gateQueueGhSchema>

export const gateQueueViewSchema = z.object({
  /** This Machine's role; null when its Profile has no cross_machine_gate (one machine, no queue). */
  role: z.enum(['serve', 'request']).nullable(),
  label: z.string().nullable(),
  /** The waiting PRs, the oldest wait first. */
  waiting: z.array(
    z.object({
      number: z.number().int().positive(),
      title: z.string(),
      url: z.string(),
      /** ISO time the wait counts from: the later of the PR's creation and its last commit. */
      since: z.string(),
    }),
  ),
  gh: gateQueueGhSchema,
})
export type GateQueueView = z.infer<typeof gateQueueViewSchema>

/** The queue of the Project; gh runs at most once per 5 minutes per Project (more rarely while it fails). */
export const gateQueueGet = invokeChannel('gateQueue.get', z.object({ projectId: z.string().min(1) }), gateQueueViewSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'gateQueue.get': typeof gateQueueGet
  }
}
