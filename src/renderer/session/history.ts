// The prompt history of the input field: ↑ and ↓ step through what the user sent to this Session.
import { typedText } from '../../shared/agent/attachments'
import type { AgentEvent } from '../../shared/agent/events'

/** What Claude Code writes as a user message when a turn is interrupted; not a prompt. */
export const INTERRUPT_NOTICE = /^\[Request interrupted by user/

/**
 * The user's messages of a Session, oldest first, as the user typed them: without the lines naming
 * their attachments (ticket 20), which are not brought back with the text.
 */
export function promptHistory(events: readonly AgentEvent[]): string[] {
  const prompts: string[] = []
  for (const event of events) {
    if (event.type !== 'notice' || event.kind !== 'user' || INTERRUPT_NOTICE.test(event.text)) continue
    const typed = typedText(event.text)
    if (typed.trim() !== '') prompts.push(typed)
  }
  return prompts
}

/**
 * Where the input field is in the history: `index` is the position of the prompt it shows, or
 * null while it shows the user's own text. ↑ goes to older prompts and stops at the oldest; ↓ goes
 * to newer ones and, past the newest, back to an empty field.
 */
export interface HistoryPosition {
  index: number | null
  text: string
}

export function stepHistory(history: readonly string[], at: number | null, direction: 'older' | 'newer'): HistoryPosition | null {
  if (history.length === 0) return null
  if (direction === 'older') {
    const index = at === null ? history.length - 1 : Math.max(0, at - 1)
    return { index, text: history[index] ?? '' }
  }
  if (at === null) return null
  if (at >= history.length - 1) return { index: null, text: '' }
  return { index: at + 1, text: history[at + 1] ?? '' }
}
