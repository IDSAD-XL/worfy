// The `assistant` domain (worfy-assistant ticket 14): the Assistant's section of the rail and its own notifications. The
// window opens the view (`assistant.open`) and then receives every change (`assistant.changed`); each click goes to main,
// which changes the attention core, the duties and the proposals through their own functions
// (src/main/assistant/window/view.ts). Settings → Assistant (ticket 15) reads and changes the duties and the checks here
// too, and Apply under a card «before → after» goes here. A system notification of the Assistant, clicked, raises the
// window and tells it to show the section (`assistant.reveal`). Every channel but one is `local`: the Assistant is this
// Machine's, and a Linked machine never reaches it (spec, two machines). The one is `assistant.waiting` (worfy-assistant
// ticket 18), `project` and `read`: a Linked machine reads what waits here and shows it read-only
// (src/shared/assistant/linked.ts).
import { z } from 'zod'
import { DUTY_ACTIONS, dutyActionModeSchema } from '../assistant/duties'
import { offerAnswerSchema } from '../assistant/intro'
import { linkedWaitsSchema } from '../assistant/linked'
import { checkKindSchema } from '../assistant/schedule/settings'
import { dutyThresholdSchema } from '../assistant/settings-change'
import { assistantSettingsViewSchema, checkNowRefusalSchema } from '../assistant/settings-view'
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

/**
 * The window showed these items to the user, in the open section or on a speech card: their duties count them as shown
 * (Duties.look). The view itself counts nothing, so a section nobody looks at never pauses a duty.
 */
export const assistantShown = invokeChannel('assistant.shown', z.object({ itemIds: z.array(id).max(500) }), z.object({}), 'local')

/**
 * The user closed the speech card (worfy-polish 161): these items, the ones it would tell of now, count as told by the
 * card until something new comes on each. Each comes with the count of events the card showed of it, so an event that
 * came after the card was drawn is not marked unseen as told. The items themselves stay as they are: in the list, in
 * their state.
 */
export const assistantCardClosed = invokeChannel(
  'assistant.cardClosed',
  z.object({ items: z.array(z.object({ id, events: z.number().int().nonnegative().optional() })).max(5_000) }),
  z.object({}),
  'local',
)

/**
 * What waits in the Projects of this Machine, for a Linked machine (worfy-assistant ticket 18; ADR-0066): the Projects and
 * the items the section shows now, words and times only. Reading: it changes nothing, counts nothing as shown, and
 * carries nothing to act with.
 */
export const assistantWaiting = invokeChannel('assistant.waiting', z.void(), linkedWaitsSchema, 'project', 'read')

/**
 * Apply under a card «before → after» (ticket 15; story 26): the change of the settings the proposal carries is applied,
 * and the card then says when. Refused, with the reason, for a proposal that is gone, changes no setting or was applied.
 */
export const assistantApply = invokeChannel('assistant.apply', z.object({ proposalId: id }), z.object({}), 'local')

/**
 * Undo under an applied card «before → after» (ticket 25): the settings the change named go back to what they were before
 * its Apply. Refused, with the reason, for a change not applied, and — naming them — when any of those settings changed
 * since the Apply.
 */
export const assistantUndo = invokeChannel('assistant.undo', z.object({ proposalId: id }), z.object({}), 'local')

/**
 * Settings → Assistant (ticket 15): the duties, the rules, the checks with their failures in a row, the wakes of today
 * and the usage. The app settings of the Assistant go through `appSettings`; the window asks this again on each
 * `assistant.changed`.
 */
export const assistantSettings = invokeChannel('assistant.settings', z.void(), assistantSettingsViewSchema, 'local')

/**
 * Changes what the user chose of a duty: whether it is on, its threshold, the mode of an action, the Projects of this
 * Machine it covers (`all` or their ids, ticket 25). Refused, with the reason, for a mode the action may not have, a
 * Project not of this Machine, or Projects for a duty whose scope is not by Project.
 */
export const assistantConfigureDuty = invokeChannel(
  'assistant.configureDuty',
  z.object({
    dutyId: id,
    enabled: z.boolean().optional(),
    thresholdMinutes: dutyThresholdSchema.optional(),
    modes: z.partialRecord(z.enum(DUTY_ACTIONS), dutyActionModeSchema).optional(),
    projects: z.union([z.literal('all'), z.array(id).max(500)]).optional(),
  }),
  z.object({}),
  'local',
)

/** Ends the pause of a duty. */
export const assistantResumeDuty = invokeChannel('assistant.resumeDuty', z.object({ dutyId: id }), z.object({}), 'local')

/** How many ignored proposals or dislikes in a row pause a duty. */
export const assistantPauseAfter = invokeChannel('assistant.pauseAfter', z.object({ count: z.number().int().min(1).max(100) }), z.object({}), 'local')

/**
 * Check now: a run of the check of `kind` at once, whatever its time. `started: false` comes with `refused`, the reason
 * (CheckScheduler.whyNotNow): `not-registered` (the check does not run on this Mac), `stopped`, `asleep`,
 * `assistant-off`, `check-off` (the person turned the check off) or `running`.
 */
export const assistantCheckNow = invokeChannel('assistant.checkNow', z.object({ kind: checkKindSchema }), z.object({ started: z.boolean(), refused: checkNowRefusalSchema.nullable() }), 'local')

/**
 * The person's answer to the one offer to turn the Assistant on (worfy-assistant ticket 16; src/shared/assistant/intro.ts):
 * `accepted` turns it on, as its switch in Settings → Assistant does, and it introduces itself; `declined` ends the offer
 * for good; `seen` notes that the message for an updated user was shown. The view then says the offer in `offer`.
 */
export const assistantOffer = invokeChannel('assistant.offer', z.object({ answer: offerAnswerSchema }), z.object({}), 'local')

declare module './channels' {
  interface IpcContract {
    'assistant.offer': typeof assistantOffer
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
    'assistant.shown': typeof assistantShown
    'assistant.cardClosed': typeof assistantCardClosed
    'assistant.waiting': typeof assistantWaiting
    'assistant.apply': typeof assistantApply
    'assistant.undo': typeof assistantUndo
    'assistant.settings': typeof assistantSettings
    'assistant.configureDuty': typeof assistantConfigureDuty
    'assistant.resumeDuty': typeof assistantResumeDuty
    'assistant.pauseAfter': typeof assistantPauseAfter
    'assistant.checkNow': typeof assistantCheckNow
  }
}
