// The `gettingStarted` domain (worfy-onboarding epic): the guided demo of worfy. Its channels are
// `local`: the Demo project and the Getting started state belong to this Machine.
//
// The state (ticket 06): whether the user was new or existing when worfy first read it, whether the
// section shows, the six steps with the time each was marked, the Demo project's record. Main owns
// it (src/main/getting-started/state.ts) and marks the steps itself from facts
// (src/main/getting-started/progress.ts); a window reads it with `gettingStarted.state`, hears
// `gettingStarted.changed` after every change, and writes only the section and the notice.
//
// `gettingStarted.createDemo` (ticket 05) creates the Demo project with one call: a git repository
// from the template in the home folder, connected to the Harness, added to the list as local to this
// Machine and made active, with its Orchestrator on the cheaper settings. While it runs, every window
// hears `gettingStarted.createProgress` with the step it is on. main: src/main/getting-started/demo.ts
// and src/main/ipc/getting-started.ts.
//
// Ticket 09: `gettingStarted.hintSeen` records that a hint of the demo Ticket's Stages was shown as a
// toast, so it is shown once (decision 10); `gettingStarted.setCost` switches the demo's Orchestrator
// between the cheaper and the more expensive settings (decision 5).
//
// Ticket 10: `gettingStarted.removeDemo` removes the Demo project after a native confirmation
// (main: src/main/getting-started/remove.ts).
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/** Which settings the Demo project's Orchestrator runs with (spec, decision 5): Sonnet with effort medium, or Opus. */
export const demoCostSchema = z.enum(['cheaper', 'more-expensive'])
export type DemoCost = z.infer<typeof demoCostSchema>

export const demoRecordSchema = z.object({
  projectId: z.string().min(1),
  /** The demo's repository. */
  path: z.string().min(1),
  /** The name of its Profile in the Harness. */
  profile: z.string().min(1),
  cost: demoCostSchema,
})
export type DemoRecord = z.infer<typeof demoRecordSchema>

/** Decided once, at the first read with nothing recorded (spec, decision 7): a Project in the list then means `existing`. */
export const gettingStartedUserSchema = z.enum(['new', 'existing'])
export type GettingStartedUser = z.infer<typeof gettingStartedUserSchema>

/** Whether the sidebar shows the section: Skip hides it, the Command palette shows it again (ticket 07). */
export const gettingStartedSectionSchema = z.enum(['shown', 'hidden'])
export type GettingStartedSection = z.infer<typeof gettingStartedSectionSchema>

/**
 * The six steps, as the keys of `steps`: 1 Check your setup, 2 Open the demo project, 3 Meet the
 * Orchestrator, 4 Ship the ticket, 5 See the review, 6 Merge.
 */
export const GETTING_STARTED_STEPS = ['1', '2', '3', '4', '5', '6'] as const
export const gettingStartedStepSchema = z.enum(GETTING_STARTED_STEPS)
export type GettingStartedStep = z.infer<typeof gettingStartedStepSchema>

export const gettingStartedSnapshotSchema = z.object({
  user: gettingStartedUserSchema,
  section: gettingStartedSectionSchema,
  /** The steps marked, each with the ISO time it was marked; a marked step is never taken back. */
  steps: z.partialRecord(gettingStartedStepSchema, z.iso.datetime()),
  /** The demo Ticket was seen in a rework round (Implementing again after REJECTED) at least once. */
  reworkSeen: z.boolean(),
  /** The notice for an existing user was shown (ticket 08). */
  noticeShown: z.boolean(),
  demo: demoRecordSchema.nullable(),
})
export type GettingStartedSnapshot = z.infer<typeof gettingStartedSnapshotSchema>

/** The state now. The first call on a Machine decides `user` and the section (decision 7). */
export const gettingStartedStateChannel = invokeChannel('gettingStarted.state', z.void(), gettingStartedSnapshotSchema, 'local')

/** The whole state again, after any change: a step marked, the section, the notice, the demo. */
export const gettingStartedChanged = eventChannel('gettingStarted.changed', gettingStartedSnapshotSchema, 'local')

/** Shows or hides the section: Skip, and "Getting started" of the Command palette (ticket 07). Answers the state. */
export const gettingStartedSetSection = invokeChannel('gettingStarted.setSection', z.object({ section: gettingStartedSectionSchema }), gettingStartedSnapshotSchema, 'local')

/** The notice for an existing user was shown (ticket 08); it is not shown again. Answers the state. */
export const gettingStartedNoticeSeen = invokeChannel('gettingStarted.noticeSeen', z.void(), gettingStartedSnapshotSchema, 'local')

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

/** The demo's Epic and its one Ticket, `todo 01` (spec, decision 14; src/main/getting-started/demo-template.ts). */
export const DEMO_TICKET_REF = { epic: 'todo', num: 1 } as const

/** The hints of the demo Ticket's Stages (decision 10; src/renderer/getting-started/hints.ts). */
export const GETTING_STARTED_HINTS = ['epic-ticket', 'implementing', 'agent-review', 'rework', 'gate-merge', 'done'] as const
export const gettingStartedHintSchema = z.enum(GETTING_STARTED_HINTS)
export type GettingStartedHint = z.infer<typeof gettingStartedHintSchema>

/**
 * A hint was shown. `first` is true for the one call that recorded it: only that window shows its
 * toast, so a hint is a toast once, across windows and restarts.
 */
export const gettingStartedHintSeen = invokeChannel('gettingStarted.hintSeen', z.object({ id: gettingStartedHintSchema }), z.object({ first: z.boolean() }), 'local')

/**
 * Sets the settings of the demo's Orchestrator (decision 5) and records `cost` in the demo record:
 * saved for its Node, and applied to its live Session from the next turn, as `agent.configure` does.
 * Rejects when there is no demo. Answers the state.
 */
export const gettingStartedSetCost = invokeChannel('gettingStarted.setCost', z.object({ cost: demoCostSchema }), gettingStartedSnapshotSchema, 'local')

export const removeDemoResultSchema = z.discriminatedUnion('removed', [
  z.object({ removed: z.literal(true) }),
  /**
   * `reason` null: the user chose Cancel and nothing was touched. Otherwise the refusal, when the
   * folder is not proven to be the demo worfy made (nothing touched), or what stays and why.
   */
  z.object({ removed: z.literal(false), reason: z.string().min(1).nullable() }),
])
export type RemoveDemoResult = z.infer<typeof removeDemoResultSchema>

/**
 * Removes the Demo project after a native confirmation (ticket 10; spec, R12 "what the removal takes
 * away"): closes the Sessions and Terminals inside its folder, then removes its Profile, its place in
 * the list, its worfy data folder, the record with steps 2–6, and the folder. Only the folder of the
 * record, and only when the Harness knows it as `worfy-demo`.
 */
export const gettingStartedRemoveDemo = invokeChannel('gettingStarted.removeDemo', z.void(), removeDemoResultSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'gettingStarted.removeDemo': typeof gettingStartedRemoveDemo
    'gettingStarted.createDemo': typeof gettingStartedCreateDemo
    'gettingStarted.createProgress': typeof gettingStartedCreateProgress
    'gettingStarted.state': typeof gettingStartedStateChannel
    'gettingStarted.changed': typeof gettingStartedChanged
    'gettingStarted.setSection': typeof gettingStartedSetSection
    'gettingStarted.noticeSeen': typeof gettingStartedNoticeSeen
    'gettingStarted.hintSeen': typeof gettingStartedHintSeen
    'gettingStarted.setCost': typeof gettingStartedSetCost
  }
}
