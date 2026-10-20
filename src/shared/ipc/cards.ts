// The `cards` domain: what the renderer needs to show a Card (CONTEXT.md, "Card") — its
// address on the worfy-card:// protocol, its title, whether its files are there — and a notice
// when its files change. Handled in src/main/ipc/cards.ts (ADR-0006).
import { z } from 'zod'
import { FILE_COPY_LIMIT_BYTES } from '../agent/attachments'
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
export const cardsGet = invokeChannel('cards.get', z.object({ projectId, cardId: cardIdSchema }), cardInfoSchema, 'project', 'read')

/** Sent to every window after the files of a Card changed (written, removed, its folder created or deleted). */
export const cardsChanged = eventChannel('cards.changed', cardInfoSchema, 'project', 'read')

/** The largest Card file a Linked machine sends (413 above it): as large as a file worfy carries anywhere else. */
export const CARD_FILE_LIMIT_BYTES = FILE_COPY_LIMIT_BYTES

/**
 * The most bytes of a Card file one `cards.file` answer carries: 4 MB, about 5.3 MB as base64, well
 * inside one message of a link connection (16 MB). A larger file comes in several calls.
 */
export const CARD_FILE_CHUNK_BYTES = 4 * 1024 * 1024

export const cardFileAnswerSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('file'),
    /** The file's extension, in lower case, with the dot; the Machine that shows the Card picks the content type from it. */
    extension: z.string().regex(/^\.[a-z0-9]{1,8}$/),
    /** The whole file's size in bytes. */
    size: z.number().int().nonnegative(),
    /**
     * When the file was last written (its mtime, with the fraction of a millisecond the disk keeps):
     * the pieces of one read must all have the same, or the file changed in between.
     */
    mtimeMs: z.number().nonnegative(),
    /** The bytes asked for, from `offset` on, as base64. */
    base64: z.string().max(Math.ceil(CARD_FILE_CHUNK_BYTES / 3) * 4),
  }),
  /** No file to serve: no single Project with the label, no such Card or file, or a path outside the Card's folder. */
  z.object({ status: z.literal('missing') }),
  /** Over the largest Card file served (CARD_FILE_LIMIT_BYTES); nothing is read. */
  z.object({ status: z.literal('too-large'), size: z.number().int().nonnegative() }),
])
export type CardFileAnswer = z.output<typeof cardFileAnswerSchema>

/**
 * A file of a Card, for a window of a Linked machine that shows it (worfy-link ticket 10). This
 * Machine finds the file as its own protocol does and sends it as it is on disk, without the Card
 * API runtime: `length` bytes from `offset` on, at most CARD_FILE_CHUNK_BYTES. `path` is the path
 * of the Card's address, still percent-encoded.
 */
export const cardsFile = invokeChannel(
  'cards.file',
  z.object({
    projectLabel: z.string().regex(/^[0-9a-f]{8}$/),
    cardId: cardIdSchema,
    path: z.string().min(1).max(4096).startsWith('/'),
    offset: z.number().int().nonnegative().default(0),
    length: z.number().int().nonnegative().max(CARD_FILE_CHUNK_BYTES).default(CARD_FILE_CHUNK_BYTES),
  }),
  cardFileAnswerSchema,
  'project',
  'read',
)

declare module './channels' {
  interface IpcContract {
    'cards.get': typeof cardsGet
    'cards.changed': typeof cardsChanged
    'cards.file': typeof cardsFile
  }
}
