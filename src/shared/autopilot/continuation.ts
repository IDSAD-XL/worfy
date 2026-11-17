// The texts of the continuation ladder of an Autopilot Run (worfy-stuck-agents ticket 05, ADR-0024 Amendments):
// the line worfy puts on the Wave that continues a stuck Ticket, the message that asks the Orchestrator to set
// a Ticket aside once its continuations are spent, and the words of the status line while a continuation runs.
//
// Only worfy's own facts go into them: Ticket numbers, the attempt and the ceiling, the cause and the minutes
// the run waited. The model's last words (`lastText` of run-stopped) never do: a text the model wrote is not
// sent back to it as an instruction (src/shared/agent/continue-plan.ts). Pure; run.ts sends them, the status
// line (src/shared/ipc/autopilot.ts) shows the last one.
import { ticketNumber } from '../actions/render-template'
import type { ContinuationCause } from './cycle'

/** How many continuations a Ticket gets in one Run before it is set aside (the owner, 2026-11-17: 2). */
export const MAX_CONTINUATIONS = 2

const tickets = (nums: readonly number[]): string => `${nums.length === 1 ? 'ticket' : 'tickets'} ${nums.map(ticketNumber).join(', ')}`

/** Why the Ticket is continued, in the Orchestrator's words: what worfy saw. */
function seen(cause: ContinuationCause, settleMinutes: number): string {
  return cause === 'wave-unfinished' ? `still claimed ${Math.max(1, Math.round(settleMinutes))} min after the turn ended` : 'came back as the same wave'
}

/**
 * The line over the Wave that continues stuck Tickets: `Continuation 1 of 2 for tickets 05, 07: still claimed
 * 10 min after the turn ended.` (`wave-unfinished`), `… came back as the same wave.` (`no-progress`).
 * `attempt` is the attempt of the Ticket nearest the ceiling `of`; `settleMinutes`, how long the run waited.
 */
export function continuationLine(input: { tickets: readonly number[]; attempt: number; of: number; cause: ContinuationCause; settleMinutes: number }): string {
  return `Continuation ${input.attempt} of ${input.of} for ${tickets(input.tickets)}: ${seen(input.cause, input.settleMinutes)}.`
}

/** The shell word of the ticket tool: quoted when its path has a space or a quote. */
const toolWord = (tool: string): string => (/[\s"'$`\\]/u.test(tool) ? `"${tool.replace(/(["$`\\])/gu, '\\$1')}"` : tool)

/**
 * The message that asks the Orchestrator to set stuck Tickets aside after `attempts` continuations: the exact
 * `ticket block <epic> <NN> "stuck: …" --waits owner` per Ticket, then the end of the turn. `Waits: owner` is
 * what lets the queue go on (epic-queue.ts). worfy writes no status itself (ADR-0002): only the Orchestrator
 * runs the command. `ticketTool`: the path of the Harness's `ticket`, `ticket` when unknown.
 */
export function setAsideText(input: { epic: string; tickets: readonly number[]; attempts: number; cause: ContinuationCause; ticketTool?: string }): string {
  const { epic, attempts, cause } = input
  const nums = input.tickets.map(ticketNumber)
  const what = cause === 'wave-unfinished' ? 'stayed claimed' : 'came back as the same wave'
  const short = cause === 'wave-unfinished' ? 'claimed' : 'same wave'
  const tool = toolWord(input.ticketTool ?? 'ticket')
  const commands = nums.map((num) => `${tool} block ${epic} ${num} "stuck: ${short} after ${attempts} continuations" --waits owner`)
  const who = `${nums.length === 1 ? 'Ticket' : 'Tickets'} ${nums.join(', ')}`
  return `${who} ${what} after ${attempts} continuations. Run: ${commands.join('; ')}. Then end the turn.`
}

/**
 * The Wave's text with the continuation line. A slash command stays first, or Claude Code would not expand it:
 * the line goes after it, past a blank line, as part of its arguments (as waveBriefText of launch.ts does). A
 * text that is not one gets the line in front.
 */
export function waveWithContinuation(text: string, line: string): string {
  return text.trimStart().startsWith('/') ? `${text}\n\n${line}` : `${line}\n\n${text}`
}

/** The status line's words while a continuation runs: `continuing 05 (1 of 2)`. */
export function continuingText(continuing: { tickets: readonly string[]; attempt: number; of: number }): string {
  return `continuing ${continuing.tickets.join(', ')} (${continuing.attempt} of ${continuing.of})`
}
