// The Autopilot command typed in a chat (worfy-flight-recorder ticket 22, ADR-0091): a message of a
// person that is `/worfy:epic-wave` with one of the forms below starts the same run as the Autopilot
// button, through startFromChat (src/main/autopilot/chat-start.ts), instead of reaching the agent.
//
//   /worfy:epic-wave tickets 05, 06 of epic X    the named Tickets
//   /worfy:epic-wave wave N of epic X            the Tickets of row N of the Waves table, not done yet
//                                                (src/shared/workflow/wave-plan.ts); `run wave N …` too
//   /worfy:epic-wave epic X                      the whole Epic
//   /worfy:epic-wave X                           the whole Epic, when the Project has Epic X
//   /worfy:epic-wave epics A, B, C               a queue of Epics, in this order (worfy-autopilot-queue
//                                                ticket 15): 1 to MAX_QUEUE_EPICS, each named once
//   /worfy:epic-wave accepted                    a queue of every accepted Epic with a ready Ticket,
//                                                oldest acceptance first (acceptedEpics, read by agent.send)
// and the older Russian forms of the tickets and the wave form that the Harness skill still takes
// (FORMS below).
//
// Any other text after `/worfy:epic-wave` ("resume after a session break", an argument such as
// `depth medium`) is not a command and goes to the agent as before: the skill reads it there. A queue
// typed wrong (a word that is no Epic name, an Epic named twice, more than MAX_QUEUE_EPICS) is a
// command all the same, kind `invalid`: it is refused in words and reaches no agent.
// Pure: the handler of `agent.send` (src/main/ipc/agent.ts) calls it and starts the run.
import { EPIC_NAME } from '../binding/resolve'
import { MAX_NAMED_TICKETS } from '../ipc/autopilot'
import { MAX_QUEUE_EPICS } from './epic-queue'

/** The command of the Harness skill that runs a Wave. */
export const EPIC_WAVE_COMMAND = '/worfy:epic-wave'

export type ChatCommand =
  | { kind: 'tickets'; epic: string; tickets: number[] }
  | { kind: 'wave'; epic: string; wave: number }
  /** `bare`: the Epic named alone, without `epic`; a word that is not an Epic of the Project is then no command. */
  | { kind: 'epic'; epic: string; bare: boolean }
  /** A queue of Epics, in the order typed, each once (worfy-autopilot-queue ticket 15). */
  | { kind: 'epics'; epics: string[] }
  /** A queue of the Project's accepted Epics with a ready Ticket (acceptedEpics), oldest acceptance first. */
  | { kind: 'accepted' }
  /** A queue typed wrong: nothing starts, and `message` says why. */
  | { kind: 'invalid'; message: string }

const EPIC = EPIC_NAME.source.replace(/^\^/u, '').replace(/\$$/u, '')
const LIST = String.raw`(\d{1,5}(?:\s*,\s*\d{1,5})*)`
const NUM = String.raw`(\d{1,5})`

/** The Ticket numbers of a list, each once, in the order typed; null past MAX_NAMED_TICKETS. */
function listOf(text: string): number[] | null {
  const nums = [...new Set(text.split(/\s*,\s*/u).map(Number))]
  return nums.length > MAX_NAMED_TICKETS ? null : nums
}

const EPIC_ONLY = new RegExp(`^${EPIC}$`, 'u')

/** The Epics of an `epics` list, comma-separated as the Tickets of `tickets`; a refusal in words when one is wrong. */
function queueOf(text: string): ChatCommand {
  const epics = text.split(/\s*,\s*/u)
  if (epics.length > MAX_QUEUE_EPICS) return { kind: 'invalid', message: `A queue holds at most ${MAX_QUEUE_EPICS} Epics: ${epics.length} are named` }
  const wrong = epics.find((epic) => !EPIC_ONLY.test(epic))
  if (wrong === '') return { kind: 'invalid', message: 'An Epic name is missing between two commas' }
  if (wrong !== undefined) return { kind: 'invalid', message: `"${wrong}" is not an Epic name` }
  const twice = epics.find((epic, at) => epics.indexOf(epic) !== at)
  if (twice !== undefined) return { kind: 'invalid', message: `Epic ${twice} is named twice in the queue` }
  return { kind: 'epics', epics }
}

const form = (pattern: string): RegExp => new RegExp(`^${pattern}$`, 'iu')

const FORMS: readonly { pattern: RegExp; read(match: RegExpExecArray): ChatCommand | null }[] = [
  {
    pattern: form(String.raw`tickets\s+${LIST}\s+of\s+epic\s+(${EPIC})`),
    read: (match) => {
      const tickets = listOf(match[1]!)
      return tickets === null ? null : { kind: 'tickets', epic: match[2]!, tickets }
    },
  },
  { pattern: form(String.raw`(?:run\s+)?wave\s+${NUM}\s+of\s+epic\s+(${EPIC})`), read: (match) => ({ kind: 'wave', epic: match[2]!, wave: Number(match[1]) }) },
  { pattern: form(String.raw`epic\s+(${EPIC})`), read: (match) => ({ kind: 'epic', epic: match[1]!, bare: false }) },
  { pattern: form(String.raw`epics\s+(.+)`), read: (match) => queueOf(match[1]!) },
  // Before the Epic named alone: `accepted` is this command, `epic accepted` the Epic of that name.
  { pattern: form('accepted'), read: () => ({ kind: 'accepted' }) },
  // shortcut: accepts the old Russian token, remove once the Harness skill epic-wave drops these forms
  {
    pattern: form(String.raw`ticket-ы\s+${LIST}\s+эпика\s+(${EPIC})`),
    read: (match) => {
      const tickets = listOf(match[1]!)
      return tickets === null ? null : { kind: 'tickets', epic: match[2]!, tickets }
    },
  },
  // shortcut: accepts the old Russian token, remove once the Harness skill epic-wave drops these forms
  { pattern: form(String.raw`волна\s+${NUM}\s+эпика\s+(${EPIC})`), read: (match) => ({ kind: 'wave', epic: match[2]!, wave: Number(match[1]) }) },
  { pattern: new RegExp(`^(${EPIC})$`, 'u'), read: (match) => ({ kind: 'epic', epic: match[1]!, bare: true }) },
]

/** The command a typed message is, or null when it is not one (it then goes to the agent). */
export function parseChatCommand(text: string): ChatCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(EPIC_WAVE_COMMAND)) return null
  const rest = trimmed.slice(EPIC_WAVE_COMMAND.length)
  // `/worfy:epic-wave` alone, or another command that starts with these letters.
  if (!/^\s/u.test(rest)) return null
  // A sentence's closing mark is not part of the Epic's name: `… of epic demo.` names `demo`.
  const args = rest.trim().replace(/[.,;:!?]+$/u, '')
  for (const each of FORMS) {
    const match = each.pattern.exec(args)
    if (match) return each.read(match)
  }
  return null
}

/** What the person is told when the command has started a run: of `epic` alone, or of the queue `epics` it begins. */
export const chatStartedText = (epic: string, epics: readonly string[] = [epic]): string =>
  epics.length > 1 ? `Autopilot started on a queue of ${epics.length} Epics: ${epics.join(', ')}` : `Autopilot started on Epic ${epic}`

/** The key and `data-testid` of the toast of a command: the next answer replaces the last one. */
export const CHAT_COMMAND_TOAST = 'autopilot-chat-toast'

/** The toast for the answer of a command (src/renderer/toast/toasts.ts, showToast): what happened, as `agent.send` answered it. */
export function chatCommandToast(answer: { kind: 'started' | 'after-turn' | 'refused'; message: string }): {
  kind: 'success' | 'info' | 'error'
  text: string
  key: string
  testId: string
} {
  const kind = answer.kind === 'started' ? 'success' : answer.kind === 'after-turn' ? 'info' : 'error'
  return { kind, text: answer.message, key: CHAT_COMMAND_TOAST, testId: CHAT_COMMAND_TOAST }
}
