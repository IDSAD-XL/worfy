// The Autopilot command typed in a chat (worfy-flight-recorder ticket 22, ADR-0091): a message of a
// person that is `/worfy:epic-wave` with one of the forms below starts the same run as the Autopilot
// button, through startFromChat (src/main/autopilot/chat-start.ts), instead of reaching the agent.
//
//   /worfy:epic-wave tickets 05, 06 of epic X    the named Tickets
//   /worfy:epic-wave wave N of epic X            the Tickets of row N of the Waves table, not done yet
//                                                (src/shared/workflow/wave-plan.ts); `run wave N …` too
//   /worfy:epic-wave epic X                      the whole Epic
//   /worfy:epic-wave X                           the whole Epic, when the Project has Epic X
// and the older Russian forms of the tickets and the wave form that the Harness skill still takes
// (FORMS below).
//
// Any other text after `/worfy:epic-wave` ("resume after a session break", an argument such as
// `depth medium`) is not a command and goes to the agent as before: the skill reads it there.
// Pure: the handler of `agent.send` (src/main/ipc/agent.ts) calls it and starts the run.
import { EPIC_NAME } from '../binding/resolve'
import { MAX_NAMED_TICKETS } from '../ipc/autopilot'

/** The command of the Harness skill that runs a Wave. */
export const EPIC_WAVE_COMMAND = '/worfy:epic-wave'

export type ChatCommand =
  | { kind: 'tickets'; epic: string; tickets: number[] }
  | { kind: 'wave'; epic: string; wave: number }
  /** `bare`: the Epic named alone, without `epic`; a word that is not an Epic of the Project is then no command. */
  | { kind: 'epic'; epic: string; bare: boolean }

const EPIC = EPIC_NAME.source.replace(/^\^/u, '').replace(/\$$/u, '')
const LIST = String.raw`(\d{1,5}(?:\s*,\s*\d{1,5})*)`
const NUM = String.raw`(\d{1,5})`

/** The Ticket numbers of a list, each once, in the order typed; null past MAX_NAMED_TICKETS. */
function listOf(text: string): number[] | null {
  const nums = [...new Set(text.split(/\s*,\s*/u).map(Number))]
  return nums.length > MAX_NAMED_TICKETS ? null : nums
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
  const args = rest.trim()
  for (const each of FORMS) {
    const match = each.pattern.exec(args)
    if (match) return each.read(match)
  }
  return null
}

/** What the person is told when the command has started a run. */
export const chatStartedText = (epic: string): string => `Autopilot started on Epic ${epic}`

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
