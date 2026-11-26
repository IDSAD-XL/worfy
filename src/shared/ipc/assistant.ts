// The `assistant` domain (worfy-assistant ticket 14): the Assistant's section of the rail and its own notifications. The
// window opens the view (`assistant.open`) and then receives every change (`assistant.changed`); each click goes to main,
// which changes the attention core, the duties and the proposals through their own functions
// (src/main/assistant/window/view.ts). A system notification of the Assistant, clicked, raises the window and tells it to
// show the section (`assistant.reveal`). Every channel is `local`: the Assistant is this Machine's, and a Linked machine
// never reaches it (spec, two machines).
import { z } from 'zod'
import { assistantViewSchema, ratingSchema, snoozeChoiceSchema } from '../assistant/window'
import { eventChannel, invokeChannel } from './channels'

const id = z.string().min(1).max(1_000)

/** The view now; the calling window then receives `assistant.changed` until it is gone. `reveal`: a notification was clicked before this window was there. */
export const assistantOpen = invokeChannel('assistant.open', z.void(), z.object({ view: assistantViewSchema, reveal: z.boolean() }), 'local')

export const assistantChanged = eventChannel('assistant.changed', assistantViewSchema, 'local')

/** A system notification of the Assistant was clicked: the window shows the Assistant's section. */
export const assistantReveal = eventChannel('assistant.reveal', z.object({}), 'local')

/**
 * What the user did to an item: `open` (the window opens its subject; the duty counts it accepted), `dismiss` (the duty
 * counts it declined), `wake` (a snoozed item waits again). Refused for an item that is not there.
 */
export const assistantItem = invokeChannel('assistant.item', z.object({ itemId: id, op: z.enum(['open', 'dismiss', 'wake']) }), z.object({}), 'local')

/** Snoozes an item; answers until when (ms), or null for «until something changes». */
export const assistantSnooze = invokeChannel('assistant.snooze', z.object({ itemId: id, choice: snoozeChoiceSchema }), z.object({ until: z.number().nullable() }), 'local')

export const ratingTargetSchema = z.object({ kind: z.enum(['item', 'proposal', 'journal', 'message', 'summary']), id })
export type RatingTarget = z.output<typeof ratingTargetSchema>

/**
 * Like or dislike a message of the Assistant, or take the rating back (null). The rating of an item, or of a journal line
 * whose item is still kept, goes to the item's duty (ticket 07); a dislike there answers the rule it wrote.
 */
export const assistantRate = invokeChannel(
  'assistant.rate',
  z.object({ target: ratingTargetSchema, rating: ratingSchema.nullable() }),
  z.object({ rule: z.object({ id: z.string(), text: z.string() }).nullable() }),
  'local',
)

/** Deletes a rule the user's dislike wrote: the items it hid show again. */
export const assistantForgetRule = invokeChannel('assistant.forgetRule', z.object({ ruleId: id }), z.object({}), 'local')

/** Dismisses a proposal of the Assistant: it leaves the book. */
export const assistantDismissProposal = invokeChannel('assistant.dismissProposal', z.object({ proposalId: id }), z.object({}), 'local')

/**
 * Start of a prepared Session, on the user's click after they read its text: a new Session Node in the Project of this
 * Machine whose first message is exactly `text`. With `itemId` the item's duty counts it accepted; with `proposalId` the
 * proposal leaves the book.
 */
export const assistantStart = invokeChannel(
  'assistant.start',
  z.object({ projectId: id, text: z.string().min(1).max(20_000), itemId: id.nullable(), proposalId: id.nullable() }),
  z.object({ projectId: z.string(), nodeId: z.string(), sessionId: z.string() }),
  'local',
)

/** The user writes to the Assistant; refused, with the reason, while it is off. Its answer comes in `assistant.changed`. */
export const assistantSend = invokeChannel('assistant.send', z.object({ text: z.string().min(1).max(10_000) }), z.object({}), 'local')

declare module './channels' {
  interface IpcContract {
    'assistant.open': typeof assistantOpen
    'assistant.changed': typeof assistantChanged
    'assistant.reveal': typeof assistantReveal
    'assistant.item': typeof assistantItem
    'assistant.snooze': typeof assistantSnooze
    'assistant.rate': typeof assistantRate
    'assistant.forgetRule': typeof assistantForgetRule
    'assistant.dismissProposal': typeof assistantDismissProposal
    'assistant.start': typeof assistantStart
    'assistant.send': typeof assistantSend
  }
}
