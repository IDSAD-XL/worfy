// The closed list of actions of the Assistant (worfy-assistant ticket 08; spec, implementation decisions, the closed list of actions;
// ADR-0114, point 4; boundaries 3 and 6). main does these actions without a model, by the mode of the duty whose item
// proposes them (ticket 07); their text is main's, never the Assistant's; each one is a line of the Assistant's journal
// with the item that caused it. The list grows only by code: an action that is not here is refused.
//
// main does them in src/main/assistant/actions/ (closed-list.ts: the one door, act(); auto.ts: what main does by
// itself). The `worfy-app` server (ticket 09) calls act() with `by: 'assistant'`, the window (ticket 14) with
// `by: 'user'`.
import { z } from 'zod'
import { dutyActionModeSchema } from './duties'

/**
 * The actions of the closed list:
 * - `wake-orchestrator` — an idle Orchestrator, with no background task alive, gets WAKE_ORCHESTRATOR_TEXT;
 * - `continue-session` — a Session on the Canvas that the Limits refused gets continueSessionText() after their reset.
 */
export const CLOSED_ACTIONS = ['wake-orchestrator', 'continue-session'] as const
export const closedActionSchema = z.enum(CLOSED_ACTIONS)
export type ClosedAction = z.infer<typeof closedActionSchema>

export function isClosedAction(action: string): action is ClosedAction {
  return (CLOSED_ACTIONS as readonly string[]).includes(action)
}

/**
 * What an idle Orchestrator gets. The Limits allow work when main sends it (auto.ts and closed-list.ts check them):
 * the text says so, because on 2026-11-13 the Orchestrator took the reset time of an old refusal for one still ahead and
 * kept three implementers stopped (ticket 08, result section).
 */
export const WAKE_ORCHESTRATOR_TEXT = [
  'worfy: this Project has stood still. You are idle, and no background task of yours is alive. The Limits allow work now.',
  'Check the Subagents you started that stopped — by the Limits, an API error or a restart of worfy — and continue each from where it stopped: SendMessage to the same agent, not a new one.',
  'If none stopped, go on with your plan, or say what you are waiting for.',
].join('\n')

/** The start of what a Session on the Canvas gets after the reset of the Limits that refused its turn. */
export const CONTINUE_SESSION_TEXT = 'Continue from where you stopped: the Limits refused your previous turn, and they have reset.'

/** What a Session on the Canvas gets after a pause for the Limits from `from` until `until` (ms since the epoch). */
export function continueSessionText(from: number, until: number): string {
  return `${CONTINUE_SESSION_TEXT}\nPause for the Limits: from ${new Date(from).toISOString()} until ${new Date(until).toISOString()}.`
}

/** Who asked for an action: main by itself (by the mode of the duty), the Assistant through `worfy-app`, the user by a click. */
export const ACTION_ACTORS = ['main', 'assistant', 'user'] as const
export type ActionActor = (typeof ACTION_ACTORS)[number]

/**
 * Why an action was refused:
 * - `not-in-list` — the action is not in the closed list;
 * - `no-item` — no open item with that id, or no duty shows it now (paused, off, below its threshold, hidden by a rule);
 * - `not-proposed` — the duty of the item does not propose the action for it;
 * - `mode` — the mode of the action does not let this actor do it (`hand-over`; `ask` for anyone but the user);
 * - `no-target` — the Session the action is for is not running, or the item is not about the Session it acts on;
 * - `run-owns` — an Autopilot run owns the Session;
 * - `busy` — the Session is in a turn, or a background task of it is alive, or Auto-continue waits to continue it;
 * - `limits` — the Limits still refuse: for continue-session, the wait for their reset is not over;
 * - `failed` — the Session did not take the message.
 */
export const ACTION_REFUSALS = ['not-in-list', 'no-item', 'not-proposed', 'mode', 'no-target', 'run-owns', 'busy', 'limits', 'failed'] as const
export type ActionRefusal = (typeof ACTION_REFUSALS)[number]

/**
 * One line of the Assistant's journal of actions: the action, who asked, the item that caused it and its duty, the
 * mode in force, the Session it went to, what became of it and the exact text sent. `escalated`: the closed list did not
 * help with the item (an Orchestrator woken before stands again), and the model of the Assistant is woken for it.
 */
export const actionJournalLineSchema = z.object({
  at: z.number(),
  action: z.string(),
  by: z.enum(ACTION_ACTORS),
  /** The item that caused it, as the request named it. */
  item: z.string(),
  duty: z.string().nullable(),
  projectId: z.string().nullable(),
  /** The item's kind and text when it was found, for the journal to read without the item. */
  itemKind: z.string().nullable(),
  itemText: z.string().nullable(),
  mode: dutyActionModeSchema.nullable(),
  /** The Session the text went to (or would have). */
  sessionId: z.string().nullable(),
  outcome: z.enum(['done', 'refused', 'escalated']),
  reason: z.enum(ACTION_REFUSALS).optional(),
  /** The text sent: only main's own. */
  text: z.string().optional(),
})
export type ActionJournalLine = z.infer<typeof actionJournalLineSchema>

/** A request to do one action of the closed list about one item. */
export interface ActionRequest {
  /** Any string: what is not in CLOSED_ACTIONS is refused (`not-in-list`) and written to the journal. */
  action: string
  itemId: string
  by: ActionActor
}

export type ActionResult = { ok: true; line: ActionJournalLine } | { ok: false; reason: ActionRefusal; line: ActionJournalLine }

/** A Session on the Canvas that waits for the reset of the Limits (seen in its chat and through the closed list). */
export interface SessionLimitsWait {
  sessionId: string
  /** The window that refused; null when the Session did not say. */
  window: string | null
  /** When the wait began (the first refusal). */
  since: number
  /** When the Limits reset (plus a margin): the wait is due from then. */
  until: number
}
