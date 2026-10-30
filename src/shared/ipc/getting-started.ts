// The `gettingStarted` domain (worfy-onboarding epic): the guided demo of worfy. Its channels are
// `local`: the Demo project and the Getting started state belong to this Machine.
//
// `gettingStarted.createDemo` (ticket 05) creates the Demo project with one call: a git repository
// from the template in the home folder, connected to the Harness, added to the list as local to this
// Machine and made active, with its Orchestrator on the cheaper settings. While it runs, every window
// hears `gettingStarted.createProgress` with the step it is on. main: src/main/getting-started/demo.ts
// and src/main/ipc/getting-started.ts.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

export const createDemoResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), projectId: z.string().min(1), path: z.string().min(1) }),
  /** Nothing of this call is left behind; `reason` says why, for the line "Could not create the demo project: <reason>". */
  z.object({ ok: z.literal(false), reason: z.string().min(1) }),
])
export type CreateDemoResult = z.infer<typeof createDemoResultSchema>

/**
 * Creates the Demo project, or answers with the one there is (its record and its folder in place).
 * A second call while one runs waits for it and gets the same answer.
 */
export const gettingStartedCreateDemo = invokeChannel('gettingStarted.createDemo', z.void(), createDemoResultSchema, 'local')

/** The step `gettingStarted.createDemo` is on, one line. */
export const gettingStartedCreateProgress = eventChannel('gettingStarted.createProgress', z.object({ step: z.string().min(1) }), 'local')

declare module './channels' {
  interface IpcContract {
    'gettingStarted.createDemo': typeof gettingStartedCreateDemo
    'gettingStarted.createProgress': typeof gettingStartedCreateProgress
  }
}
