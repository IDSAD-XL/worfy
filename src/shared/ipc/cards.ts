// The `cards` domain: what the renderer needs to show a Card (CONTEXT.md, «Карточка») — its
// address on the worfy-card:// protocol, its title, whether its files are there — and a notice
// when its files change. Handled in src/main/ipc/cards.ts (ADR-0006).
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/**
 * A Card id is one DNS label: lower-case letters, digits and inner dashes, at most 63 characters.
 * It is the first part of the Card's host name (worfy-card://<id>.<project label>/), so it must
 * survive host canonicalisation unchanged; a UUID fits.
 */
export const CARD_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
export const cardIdSchema = z.string().regex(CARD_ID_PATTERN, 'a Card id is lower-case letters, digits and inner dashes, at most 63 characters')

const projectId = z.string().min(1)

export const cardInfoSchema = z.object({
  projectId,
  cardId: cardIdSchema,
  /** The Card's index.html on its own origin. */
  url: z.string().min(1),
  /** False when the Card's folder is gone: the Node then says "Card files missing". */
  exists: z.boolean(),
  /** The text of index.html's <title>, or null when there is none. */
  title: z.string().nullable(),
  /** Grows with every change main has seen in the Card's files; the Node reloads the Card on a new one. */
  revision: z.number().int().nonnegative(),
})
export type CardInfo = z.output<typeof cardInfoSchema>

/** One Card of a Project. An unknown Project is refused; a Card without a folder comes back with exists: false. */
export const cardsGet = invokeChannel('cards.get', z.object({ projectId, cardId: cardIdSchema }), cardInfoSchema, 'project')

/** Sent to every window after the files of a Card changed (written, removed, its folder created or deleted). */
export const cardsChanged = eventChannel('cards.changed', cardInfoSchema, 'project')

declare module './channels' {
  interface IpcContract {
    'cards.get': typeof cardsGet
    'cards.changed': typeof cardsChanged
  }
}
