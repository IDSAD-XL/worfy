// Command request of Terminal AI: the user asks in words, Sonnet answers with a command, and the
// command lands in the line of the shell. It never runs: Enter stays the user's.
//
// Two ways in, one request:
//   - the line `# <words>` and Enter in a Terminal's zsh: src/main/terminal/zsh/rc.d/40-command-request.zsh
//     sends `ask <id> request <line>`, and this handler answers;
//   - the ⌘I panel over a Terminal Node: the channel `terminalAi.request` (src/main/ipc/terminal-ai-request.ts)
//     calls requestCommand() and pushes the command to the shell itself.
//
// The answer to an ask goes out as an empty `status` for the ask, then `insert <command>`, in one go:
// `insert` carries no id, and the shell tells by that `status` whether the answer belongs to the
// request that is still open or to one the user already left with a key (then the insert is
// dropped there). A refusal is a grey `status` with its reason.
//
// The model gets the words, the folder, the last commands, the branch and the exit code
// (src/main/terminal-ai/input.ts), and the line typed in the shell: for `# …` the line itself is the
// request, so the line in the context is empty; the panel sends what is typed in the line while it
// is open. Nothing here writes a log line: the words, the line and the answer stay out of the log.
import type { AssistAnswer, AssistService } from '../assist'
import { terminalAiInput } from '../input'
import type { ShellState } from '../../terminal/osc'
import type { ShellFeature } from '../shell-link'

/** The words of a Command request in the line `# <words>`; null for any other line. */
export function requestWords(line: string): string | null {
  if (!line.startsWith('# ') || /[\n\r]/.test(line)) return null
  const words = line.slice(2).trim()
  return words === '' ? null : words
}

/** What requestCommand() needs of main. */
export interface RequestContext {
  shellState(terminal: string): ShellState | null
  assist(): Promise<Pick<AssistService, 'request'>>
}

/**
 * Asks the assist service for a command for `words`, with what the shell integration knows of the
 * Terminal and `line`, the line typed in the shell. Null when the shell has not told its folder yet:
 * then nothing is asked.
 */
export async function requestCommand(context: RequestContext, terminal: string, words: string, line: string, signal?: AbortSignal): Promise<AssistAnswer | null> {
  const state = context.shellState(terminal)
  const input = state === null ? null : terminalAiInput(state, line, { request: words })
  if (input === null) return null
  return (await context.assist()).request('request', input, signal)
}

/** The note of a shell that has not told its folder yet. */
export const NOT_READY = 'The shell is not ready yet'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `14:20` today, `Oct 16, 14:20` on another day; the time of this Machine. */
export function clockText(at: number, now: number): string {
  const date = new Date(at)
  const today = new Date(now)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
  return sameDay ? time : `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}, ${time}`
}

/** The short grey note of a refusal; null for a request the user cancelled, which needs none. */
export function refusalText(answer: Extract<AssistAnswer, { ok: false }>, now: number = Date.now()): string | null {
  switch (answer.reason) {
    case 'cancelled':
      return null
    case 'limits':
      return answer.until === undefined ? 'Limits reached' : `Limits reached until ${clockText(answer.until, now)}`
    case 'off':
      return 'Terminal AI is off'
    case 'command-running':
    case 'alternate-screen':
      return 'Terminal is busy'
    case 'timeout':
      return 'Claude did not answer in time'
    case 'empty':
      return 'Claude had no command for that'
    default:
      return 'Claude could not answer'
  }
}

const commandRequest: ShellFeature = {
  feature: 'request',
  async ask(ask, reply, context) {
    const words = requestWords(ask.line)
    if (words === null) return
    // The line `# …` is the request itself: no line goes with it.
    const answer = await requestCommand(context, ask.terminal, words, '', ask.signal)
    if (answer === null) {
      reply.status(NOT_READY)
      return
    }
    if (answer.ok) {
      // Both or neither: the shell takes the insert as the answer to this ask by the status before it.
      if (reply.status('')) reply.insert(answer.command)
      return
    }
    const note = refusalText(answer)
    if (note !== null) reply.status(note)
  },
}

export default commandRequest
