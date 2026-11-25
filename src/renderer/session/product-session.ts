import { createContext } from 'react'
import type { QueuedMessage, QueueSnapshot, SessionState } from '../../shared/agent/events'
import { ASK_USER_QUESTION, parseQuestions, type Question } from '../../shared/agent/questions'
import type { ToolCall, TranscriptItem } from './fold'

// What the Session view's parts share about a Product Session (worfy-product-session ticket 07), apart
// from its body (ProductSessionPanel.tsx): a file of components may export nothing else.

/** True inside a Product Session's chat: the transcript draws the conversation only (ticket 19). */
export const ProductSessionContext = createContext(false)

/**
 * The items of the input field's bar (composer/index.ts) a Product Session leaves out (Q4 of the owner's
 * decisions of 2026-11-08, ticket 19): the context meter, the queue and the model, effort and permission
 * pickers; and the chip of MCP servers, which a Product Session's header never had either (worfy-mcp-live
 * ticket 09). Its field keeps the text, Send, Interrupt and attaching a picture.
 */
export const PRODUCT_SESSION_HIDDEN_COMPOSER_ITEMS: readonly string[] = ['ContextMeter', 'Queue', 'Pickers', 'McpServers']

/**
 * Whether a Product Session's chat draws a row (Q1 of the owner's decisions of 2026-11-08, ticket 19): the
 * owner's messages, the advisor's answers, a turn that failed or was interrupted, the Session's error, and
 * the permission and question cards. Thinking, tool calls (a failed one too), Subagents, hooks, Claude
 * Code's notices and its synthetic messages, «Turn finished» and slash commands are left out: the whole
 * log is in the Flight Recorder. A question answered before Resume is drawn too (productChatItems). The rows are folded as for any Session (fold.ts); only the drawing and
 * find (transcript-find.ts) skip the others.
 */
export function shownInProductChat(item: TranscriptItem): boolean {
  switch (item.kind) {
    case 'prompt':
    case 'error':
      return true
    case 'text':
      return !item.synthetic
    case 'result':
      return item.event.isError || item.event.interrupted
    case 'extension':
      return item.event.type === 'permission_request' || item.event.type === 'question_request'
    default:
      return false
  }
}

/**
 * An AskUserQuestion call the owner answered, as the Session's file holds it (worfy-polish ticket 147): after
 * Resume or a reload there is no question request, only the call and its result. `answers` maps a question's
 * text to the answer the result names; a question the result does not name is not in it.
 */
export interface AnsweredQuestion {
  toolUseId: string
  questions: Question[]
  answers: Record<string, string>
}

/**
 * The answers Claude Code's result of an AskUserQuestion call names: `"<question>"="<answer>"` for each
 * question, joined by ", " (src/main/agent/fake-query.ts, questionResultText, copies its words). An answer
 * runs to the next question's `", "<question>"="`, or to the last `"` of the text.
 */
function namedAnswers(questions: readonly Question[], content: string): Record<string, string> {
  const marks = questions
    .map((each) => ({ question: each.question, at: content.indexOf(`"${each.question}"="`) }))
    .filter((each) => each.at !== -1)
    .sort((a, b) => a.at - b.at)
  const entries: [string, string][] = []
  marks.forEach((mark, index) => {
    const start = mark.at + mark.question.length + 4
    const next = marks[index + 1]
    const end = next === undefined ? content.lastIndexOf('"') : content.lastIndexOf('", ', next.at)
    if (end >= start) entries.push([mark.question, content.slice(start, end)])
  })
  // Object.fromEntries keeps a question whose text is "__proto__" as its own key (formatAnswers does the same).
  return Object.fromEntries(entries)
}

/** The call as an answered question; null for another tool, a call with no result yet, a refused one, or one the owner did not answer. */
export function answeredQuestion(call: ToolCall): AnsweredQuestion | null {
  if (call.name !== ASK_USER_QUESTION || call.result === null || call.result.isError) return null
  const questions = parseQuestions(call.input)
  if (questions === null) return null
  const answers = namedAnswers(questions, call.result.content)
  return Object.keys(answers).length === 0 ? null : { toolUseId: call.id, questions, answers }
}

/**
 * The rows a Product Session's chat draws, in order: the ones shownInProductChat keeps, and the answered
 * questions read back from the Session's file (worfy-polish ticket 147), each group of tool calls cut to
 * them. A question still asked in this window has its request's card: its call adds no second one.
 */
export function productChatItems(items: readonly TranscriptItem[]): TranscriptItem[] {
  const asked = new Set<string>()
  for (const item of items) if (item.kind === 'extension' && item.event.type === 'question_request' && item.event.toolUseId !== null) asked.add(item.event.toolUseId)
  const drawn: TranscriptItem[] = []
  for (const item of items) {
    if (shownInProductChat(item)) drawn.push(item)
    else if (item.kind === 'tools') {
      const calls = item.calls.filter((call) => !asked.has(call.id) && answeredQuestion(call) !== null)
      if (calls.length > 0) drawn.push({ ...item, calls })
    }
  }
  return drawn
}

/**
 * The Session's queue as a Product Session's chat draws it (ticket 28, owner 2026-11-09): every message still
 * queued, oldest first, after the last row. `queued` — it goes on its own after the running turn; `held` —
 * Interrupt or a crash held the queue (src/main/agent/queue.ts), it waits for «Send queued»; `not-sent` —
 * the Session is closed, and a closed Session sends nothing more. Null when nothing is queued.
 */
export interface ChatQueue {
  items: readonly QueuedMessage[]
  status: 'queued' | 'held' | 'not-sent'
}

export function chatQueue(queue: QueueSnapshot | null, state: SessionState): ChatQueue | null {
  if (queue === null || queue.items.length === 0) return null
  const status = state === 'closed' ? 'not-sent' : queue.paused ? 'held' : 'queued'
  return { items: queue.items, status }
}
