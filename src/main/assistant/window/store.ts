// What the Assistant's section keeps of its own (worfy-assistant ticket 14): `<WORFY_DATA_DIR>/assistant/window.json`, in
// worfy's own data folder (ADR-0005), outside every repository — the snoozes of items, the user's likes and dislikes of
// the Assistant's messages, the conversation, and what the speech card told of when it was last closed. The items themselves, the duties and the proposals stay where their
// tickets keep them (03, 07, 09); only main writes this file, through src/main/storage/json-file.ts.
import { join } from 'node:path'
import { z } from 'zod'
import { conversationMessageSchema, ratingSchema } from '../../../shared/assistant/window'
import { readJsonFile, writeJsonFile } from '../../storage/json-file'

/** The most messages of the conversation the file keeps: the oldest leave first. */
export const CONVERSATION_KEEP = 200
/** The most ratings the file keeps: the oldest leave first. */
export const RATINGS_KEEP = 1_000

export const snoozeSchema = z.object({
  itemId: z.string(),
  /** The item's Project; null for the Machine's own. */
  scope: z.string().nullable(),
  /** Until when, ms; null: until the item's revision changes. */
  until: z.number().nullable(),
  revision: z.string(),
})
export type Snooze = z.output<typeof snoozeSchema>

export const windowStateSchema = z.object({
  snoozes: z.array(snoozeSchema),
  /** The rating of each message by its key (`item:<id>`, `journal:<id>`…), and the rule a dislike of an item wrote. */
  ratings: z.array(
    z.object({
      key: z.string(),
      rating: ratingSchema,
      at: z.number(),
      rule: z.string().optional(),
      /** The duty and the item the rating was counted for (Duties.rate), so taking it back uncounts it (Duties.unrate). */
      counted: z.object({ duty: z.string(), item: z.string(), run: z.number().int().nonnegative().optional() }).optional(),
    }),
  ),
  conversation: z.array(conversationMessageSchema),
  /**
   * What the speech card told of when the user last closed it (worfy-polish 161): the number of events of each item then
   * (AttentionItem.events, as the wake planner keeps what it delivered), and whether it was urgent. An item counts as told
   * while both are the same. Absent until the first close: the card then sums up the backlog in one line.
   */
  card: z.object({ told: z.record(z.string(), z.object({ events: z.number().int().nonnegative(), urgent: z.boolean() })) }).optional(),
})
export type WindowState = z.output<typeof windowStateSchema>

export interface WindowStateStore {
  read(): WindowState
  /** Throws when it cannot write. */
  write(state: WindowState): void
}

const empty = (): WindowState => ({ snoozes: [], ratings: [], conversation: [] })

/** The file under worfy's data root. */
export function windowStatePath(root: string): string {
  return join(root, 'assistant', 'window.json')
}

/** The store over `file`; an unreadable file is set aside by readJsonFile and the section starts afresh. */
export function windowStateFile(file: string): WindowStateStore {
  return {
    read: () => readJsonFile(file, windowStateSchema) ?? empty(),
    write: (state) =>
      writeJsonFile(file, windowStateSchema, {
        ...state,
        ratings: state.ratings.slice(-RATINGS_KEEP),
        conversation: state.conversation.slice(-CONVERSATION_KEEP),
      }),
  }
}

/** A store in memory, for tests. */
export function memoryWindowState(initial: WindowState = empty()): WindowStateStore {
  let kept = structuredClone(initial)
  return {
    read: () => structuredClone(kept),
    write: (state) => {
      kept = structuredClone({ ...state, ratings: state.ratings.slice(-RATINGS_KEEP), conversation: state.conversation.slice(-CONVERSATION_KEEP) })
    },
  }
}
