import { createContext } from 'react'
import type { TranscriptItem } from './fold'

// What the Session view's parts share about a Product Session (worfy-product-session ticket 07), apart
// from its body (ProductSessionPanel.tsx): a file of components may export nothing else.

/** True inside a Product Session's chat: the transcript draws the conversation only (ticket 19). */
export const ProductSessionContext = createContext(false)

/** The rail block a Product Session never shows: the Binding to a Ticket or an Epic. */
export const PRODUCT_SESSION_HIDDEN_BLOCKS: readonly string[] = ['BindingRail']

/**
 * The items of the input field's bar (composer/index.ts) a Product Session leaves out (Q4 of the owner's
 * decisions of 2026-11-08, ticket 19): the context meter, the queue and the model, effort and permission
 * pickers. Its field keeps the text, Send, Interrupt and attaching a picture.
 */
export const PRODUCT_SESSION_HIDDEN_COMPOSER_ITEMS: readonly string[] = ['ContextMeter', 'Queue', 'Pickers']

/**
 * Whether a Product Session's chat draws a row (Q1 of the owner's decisions of 2026-11-08, ticket 19): the
 * owner's messages, the advisor's answers, a turn that failed or was interrupted, the Session's error, and
 * the permission and question cards. Thinking, tool calls (a failed one too), Subagents, hooks, Claude
 * Code's notices and its synthetic messages, «Turn finished» and slash commands are left out: the whole
 * log is in the Flight Recorder. The rows are folded as for any Session (fold.ts); only the drawing and
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
