// The introduction of the Assistant (worfy-assistant ticket 16; owner's decisions 10, 12 and 19; stories 27–30): worfy
// offers to turn the Assistant on once — on the welcome page of First run for a new user, in one message after an update
// for an existing one — and the Assistant introduces itself the first time it is turned on, by that offer or in Settings
// → Assistant. main keeps whether the offer was answered and whether the Assistant has introduced itself
// (src/main/assistant/intro/); the window reads it in the Assistant's view (`offer`) and answers the offer with
// `assistant.offer` (src/shared/ipc/assistant.ts).
import { z } from 'zod'

/**
 * What the person did with the offer: turned the Assistant on with it (`accepted`), refused it (`declined`: it is never
 * offered again), or let the one message for an updated user go without either (`seen`: the message is not shown again,
 * and the offer stays in the Assistant's section).
 */
export const OFFER_ANSWERS = ['accepted', 'declined', 'seen'] as const
export const offerAnswerSchema = z.enum(OFFER_ANSWERS)
export type OfferAnswer = z.output<typeof offerAnswerSchema>

export const offerViewSchema = z.object({
  /** The offer still stands: the Assistant is off, has never introduced itself, and the person neither took nor refused it. */
  owed: z.boolean(),
  /** The one message for an updated user is still owed: the offer stands and no message was shown yet. */
  notice: z.boolean(),
})
export type OfferView = z.output<typeof offerViewSchema>

/** No offer: what a view without the introduction answers. */
export const NO_OFFER: Readonly<OfferView> = Object.freeze({ owed: false, notice: false })
