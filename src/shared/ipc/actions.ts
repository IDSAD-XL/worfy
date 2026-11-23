// The `actions` domain (ticket 23): "Ship ticket" and "Run wave" from the Canvas, "Process gate
// queue" from the palette and the Project menu (worfy-windows ticket 17), "Draft replies" on a pull
// request (worfy-pr-inbox ticket 04), "Fix checks", "Resolve conflicts" and "Address comments" on a pull
// request (worfy-pr-follow ticket 01), and "Record owner check" on a manual item (worfy-acceptance ticket 03). worfy starts the
// work with the same skills the terminal does and never writes a Ticket's status itself (ADR 0002):
// main reads the Project's action template, fills it in (src/shared/actions/render-template.ts)
// and sends the text — to a new Session in the Project's root, or to the Project's Orchestrator.
// Run by src/main/actions/launch.ts, handled in src/main/ipc/actions.ts (ADR-0006). "Open PR" needs
// no channel of its own: it is `shell.openExternal`.
import { z } from 'zod'
import { epicNameSchema, ticketNumSchema } from '../binding/resolve'
import { OWNER_CHECK_COPIES, OWNER_CHECK_PLATFORMS, OWNER_CHECK_SHA, OWNER_CHECK_VERDICTS, PR_FOLLOW_ACTIONS } from '../projects/action-templates'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)

const canvasSpot = z.object({ x: z.number().finite(), y: z.number().finite() })

/**
 * Starts a new Session in the Project's root (as "New session" does) and sends it the rendered
 * "Ship ticket" template; the Session is bound to the Ticket. Refused, with the reason the button
 * shows, when the Ticket is not open, a Session launched for it is still live, a blocker is not
 * done, or the template is empty or fails.
 *
 * `near` (worfy-daily ticket 28): the top-left corner the Session Node may not go left of or above,
 * in canvas units. Only the renderer knows where the Epic frames and the Ticket are drawn
 * (ADR-0032), so it sends the spot right of the frames' column, one FRAME_GAP off its right edge, at
 * the Ticket's height; main puts the Node on the first clear spot there, from that height down.
 * Without it the Node goes where every new Node goes.
 */
export const actionsShipTicket = invokeChannel(
  'actions.shipTicket',
  z.object({ projectId, epic: epicNameSchema, num: ticketNumSchema, near: canvasSpot.optional() }),
  z.object({
    /** The new Session Node. */
    nodeId: z.string().min(1),
    /** The live Session's id for the `agent.*` channels (temporary until Claude Code reports its own). */
    sessionId: z.string().min(1),
    /** What was sent. */
    text: z.string().min(1),
  }),
  'project',
  'write',
)

/**
 * Sends the rendered "Run wave" template to the Project's Orchestrator — into its queue while a
 * turn runs — and binds the Orchestrator to the Epic. Refused when the Epic has no ready Wave or
 * the template is empty or fails.
 */
export const actionsRunWave = invokeChannel(
  'actions.runWave',
  z.object({ projectId, epic: epicNameSchema }),
  z.object({
    sessionId: z.string().min(1),
    text: z.string().min(1),
    /** `queued`: the Orchestrator was busy, the text waits in its queue (ticket 19). */
    delivery: z.enum(['sent', 'queued']),
  }),
  'project',
  'write',
)

/**
 * "Process gate queue" (worfy-windows ticket 17): sends the Project's template to its Orchestrator —
 * into its queue while a turn runs. Refused, with the reason, when this Machine's role in the
 * cross-machine gate is not `serve`, the template is empty, or Autopilot runs in the Project.
 */
export const actionsGateQueue = invokeChannel(
  'actions.gateQueue',
  z.object({ projectId }),
  z.object({
    sessionId: z.string().min(1),
    text: z.string().min(1),
    delivery: z.enum(['sent', 'queued']),
  }),
  'project',
  'write',
)

/**
 * A repository on GitHub as `owner/name`: an owner of letters, digits and inner hyphens, a name of letters, digits,
 * dots, hyphens and underscores. The value goes into the first message of a Session that runs in bypassPermissions,
 * so nothing else passes: no space, no line break, no second slash.
 */
export const githubRepoSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/)

/**
 * "Draft replies" (worfy-pr-inbox ticket 04, ADR-0105): starts a new Session Node of the Project on Claude Code,
 * with a person, whose first message is the Project's "Draft replies" template filled in with the pull request
 * (`/worfy:pr-reply {repo}#{pr}` by default). The skill writes reply drafts into files on this machine and posts
 * nothing. Autopilot never calls it. `write`: a Linked machine with read-only access is refused. Refused, with the
 * reason, when the template is empty (the old Harness has no such skill) or does not render.
 */
export const actionsPrReply = invokeChannel(
  'actions.prReply',
  z.object({ projectId, repo: githubRepoSchema, pr: z.number().int().positive() }),
  z.object({
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
    text: z.string().min(1),
  }),
  'project',
  'write',
)

/**
 * "Fix checks", "Resolve conflicts" and "Address comments" (worfy-pr-follow ticket 01): the Project's template of
 * `action` filled in with the pull request and its head (`/worfy:pr-fix checks {repo}#{pr} {sha}` by default) goes to
 * a Session of the Project on Claude Code. Main reads the PR again first (PrInbox.refresh), so `{sha}` is the head of
 * that read and a reason gone meanwhile refuses the click. The Session is, in this order:
 *
 * 1. the Session Node bound (manual or launch) to the PR's Ticket, on Claude Code, not archived, whose transcript's
 *    last record is younger than 24 hours: continued when no process runs (NodeSessions.started), the text sent to it
 *    — `sent`, or `queued` while a turn runs — with a notice line only the user sees;
 * 2. else a new Session Node (`new`), at `near` as "Ship ticket" puts one, bound by launch to the PR's Ticket when
 *    it has one.
 *
 * Refused, with the reason, when the template is empty, Autopilot runs in the Project, the Project's Orchestrator is
 * busy with a Binding to the Epic of the PR's Ticket (its Wave fixes its own PRs), the PR is not the user's, comes
 * from a fork or is closed, or the action's reason is gone. `write`: a Linked machine with read-only access is refused.
 */
export const actionsPrFollow = invokeChannel(
  'actions.prFollow',
  z.object({ projectId, repo: githubRepoSchema, pr: z.number().int().positive(), action: z.enum(PR_FOLLOW_ACTIONS), near: canvasSpot.optional() }),
  z.object({
    /** The Session Node the text went to. */
    nodeId: z.string().min(1),
    sessionId: z.string().min(1),
    text: z.string().min(1),
    /** `sent` and `queued`: to the Ticket's Session, at once or into its queue; `new`: a new Session Node's first message. */
    delivery: z.enum(['sent', 'queued', 'new']),
  }),
  'project',
  'write',
)

/** The longest comment of the owner "Record owner check" takes. */
export const OWNER_WORDS_MAX = 10_000

/**
 * The decision "Record owner check" sends (worfy-acceptance ticket 03): each word of the skill owner-check checked here,
 * as githubRepoSchema checks a repository, since the text goes to the Orchestrator, a Session in bypassPermissions.
 * `words`, the owner's comment, is free text: it never fills a placeholder, it follows the command as a quote
 * (src/shared/actions/render-template.ts, ownerCheckState). `itemText`: the item's text as the owner saw it (the
 * Acceptance row's `item.text`); main refuses the decision when item `item` of the Ticket file has another text now —
 * an item added above, the item rewritten — so it never lands on another item. Never sent to the Orchestrator.
 */
export const ownerCheckDecisionSchema = z.object({
  epic: epicNameSchema,
  num: ticketNumSchema,
  item: z.number().int().positive(),
  itemText: z.string().min(1).max(OWNER_WORDS_MAX),
  verdict: z.enum(OWNER_CHECK_VERDICTS),
  platform: z.enum(OWNER_CHECK_PLATFORMS),
  copy: z.enum(OWNER_CHECK_COPIES),
  sha: z.string().regex(OWNER_CHECK_SHA),
  words: z.string().max(OWNER_WORDS_MAX),
})

/**
 * "Record owner check" (worfy-acceptance ticket 03): the Project's template filled in with the decision
 * (`/worfy:owner-check {epic} {NN} {item} {verdict} {platform} {copy} {sha}` by default) and the paragraph "Owner's
 * words:" goes to the Project's Orchestrator — into its queue while a turn runs, as "Run wave" does. The skill writes
 * the `owner-check` line; worfy only sends the text (ADR-0002). Once sent, main keeps the decision as "Sent" until the
 * line comes (src/main/acceptance/sent-store.ts). Refused, with the reason and nothing sent, while Autopilot runs in the
 * Project (spec Q6), when the template is empty or does not render, when the item is not a manual item of the Ticket
 * that waits for the owner, or when its text is no longer `itemText`. An error of the send itself reaches the caller,
 * and nothing is kept as "Sent". `write`: a Linked machine with read-only access is refused.
 */
export const actionsOwnerCheck = invokeChannel(
  'actions.ownerCheck',
  ownerCheckDecisionSchema.extend({ projectId }),
  z.object({
    sessionId: z.string().min(1),
    text: z.string().min(1),
    delivery: z.enum(['sent', 'queued']),
  }),
  'project',
  'write',
)

/**
 * The Tickets of a Project that "Ship ticket" has a live Session for. Main keeps them from the
 * launch until that Session closes: the Ticket stays open until the launched agent runs
 * `ticket claim`, and a second launch meanwhile would put two agents on one Ticket. `revision`
 * grows with every change of any Project; a client keeps the snapshot with the highest one.
 */
const launchesSchema = z.object({
  projectId,
  revision: z.number().int().nonnegative(),
  tickets: z.array(z.object({ epic: epicNameSchema, num: ticketNumSchema })),
})
export type LaunchesSnapshot = z.infer<typeof launchesSchema>

export const actionsLaunches = invokeChannel('actions.launches', z.object({ projectId }), launchesSchema, 'project', 'read')

/** Sent to every window whenever a Project's launched Tickets change. */
export const actionsLaunchesChanged = eventChannel('actions.launches.changed', launchesSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'actions.shipTicket': typeof actionsShipTicket
    'actions.runWave': typeof actionsRunWave
    'actions.gateQueue': typeof actionsGateQueue
    'actions.prReply': typeof actionsPrReply
    'actions.prFollow': typeof actionsPrFollow
    'actions.ownerCheck': typeof actionsOwnerCheck
    'actions.launches': typeof actionsLaunches
    'actions.launches.changed': typeof actionsLaunchesChanged
  }
}
