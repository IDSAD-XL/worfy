// The `projectPulse` domain (worfy-polish ticket 99): the live state of every Project of a Machine in one
// answer — its live and busy Sessions, the pull requests that need the user, the Tickets that wait for a
// person — for the sidebar under «All Projects»: the Sessions grouped by Project, the cards of the Projects
// section and the busy badge of the Sessions rail button. main keeps one reader for all of it, whatever the
// number of windows and Projects (src/main/claude-home/pulse.ts): the registry of live Sessions is one
// folder for every Project, the PR inbox and the Stages of the Pipeline are main's own already. Read-only
// (ADR-0002, ADR-0005); the main process side is src/main/ipc/project-pulse.ts.
import { z } from 'zod'
import { liveSessionSchema } from './claude-home'
import { eventChannel, invokeChannel } from './channels'

export const projectPulseSchema = z.object({
  projectId: z.string().min(1),
  /** The Sessions of the registry whose cwd lies in the Project's root or one of its worktrees, by pid. */
  live: z.array(liveSessionSchema),
  /** How many of `live` are busy, as Claude Code writes it. */
  busy: z.number().int().nonnegative(),
  /** The pull requests in the groups that need the user (review, answer, fix); null while the Project's PR inbox is off. */
  prNeedYou: z.number().int().nonnegative().nullable(),
  /**
   * The Tickets in work that are blocked or wait for a person (the owner, the team), not for an agent;
   * null while main computes no Stages for the Project — no window shows its Pipeline.
   */
  waits: z.number().int().nonnegative().nullable(),
})
export type ProjectPulse = z.infer<typeof projectPulseSchema>

export const projectPulseStateSchema = z.object({
  /** Every Project of the Machine, in the order of its Project list. */
  projects: z.array(projectPulseSchema),
})
export type ProjectPulseState = z.infer<typeof projectPulseStateSchema>

/**
 * The live state of every Project of the Machine, and from now on `projectPulse.changed` to the calling
 * window whenever any of it changes, until the window is gone. There is no call that ends it: a window
 * subscribes once and keeps it, so a Linked machine — which serves every window of a Machine with one
 * client (src/main/ipc/linked.ts) — never has one window's leave end the others'.
 */
export const projectPulseGet = invokeChannel('projectPulse.get', z.void(), projectPulseStateSchema, 'project', 'read')

/** The whole state again, after a change of any Project's part of it. */
export const projectPulseChanged = eventChannel('projectPulse.changed', projectPulseStateSchema, 'project', 'read')

/** Who a Ticket waits for when it waits for no person: the Stages of the agents (src/shared/workflow/pipeline.ts). */
const AGENT = 'agent'

/** Whether a Ticket counts in `waits`: in work (neither queued nor done), and blocked or waiting for someone other than an agent. */
export function waitsForPerson(ticket: { kind: string; blocked: unknown; waits: string | null }): boolean {
  if (ticket.kind === 'queued' || ticket.kind === 'done') return false
  return ticket.blocked !== null || (ticket.waits !== null && ticket.waits !== AGENT)
}

declare module './channels' {
  interface IpcContract {
    'projectPulse.get': typeof projectPulseGet
    'projectPulse.changed': typeof projectPulseChanged
  }
}
