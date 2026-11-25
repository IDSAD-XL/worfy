// Where the attention core keeps its items (worfy-assistant ticket 03; spec, implementation decisions, the attention core, storage):
// `<Project data folder>/assistant-items.json` for a Project's items, next to its settings.json in worfy's own data
// folder (ADR-0005), and `<WORFY_DATA_DIR>/assistant/items.json` for the Machine's own (Limits, a Health check row of
// no Project). Besides the items, the file keeps the keys of the events already taken (so a repeat after a restart
// gives nothing) and the pending «nothing happened» conditions.
import { join } from 'node:path'
import { z } from 'zod'
import { attentionItemSchema, attentionPrSchema, attentionSubjectSchema, attentionSourceSchema } from '../../../shared/assistant/attention'
import { readJsonFile, writeJsonFile } from '../../storage/json-file'

export const ATTENTION_FILE = 'assistant-items.json'

export const attentionConditionSchema = z.object({
  id: z.string().min(1),
  revision: z.string(),
  source: attentionSourceSchema,
  projectId: z.string().nullable(),
  subject: attentionSubjectSchema,
  kind: z.string(),
  text: z.string(),
  /** When the condition holds unless something happens on its subject first, ms since the epoch. */
  dueAt: z.number(),
  /** The duty its item belongs to, when the source named one (ticket 07). */
  duty: z.string().optional(),
  pr: attentionPrSchema.optional(),
})
export type AttentionCondition = z.infer<typeof attentionConditionSchema>

export const attentionFileSchema = z.object({
  /** When the core first kept this scope: past events older than it are history, not items. */
  since: z.number(),
  items: z.array(attentionItemSchema),
  /** The key of each event taken (source, id, revision) and when. */
  seen: z.record(z.string(), z.number()),
  conditions: z.array(attentionConditionSchema),
})
export type AttentionFile = z.infer<typeof attentionFileSchema>

/** One file per scope: a Project's id, or null for the Machine. */
export interface AttentionStore {
  read(scope: string | null): AttentionFile | undefined
  write(scope: string | null, file: AttentionFile): void
}

/** The store over files: `pathOf` answers the file of a scope. An unreadable file is set aside by readJsonFile. */
export function attentionFileStore(pathOf: (scope: string | null) => string): AttentionStore {
  return {
    read: (scope) => readJsonFile(pathOf(scope), attentionFileSchema),
    write: (scope, file) => writeJsonFile(pathOf(scope), attentionFileSchema, file),
  }
}

/** The files of the app: a Project's in its data folder, the Machine's under worfy's data root. */
export function attentionPaths(dataDir: (projectId: string) => string, root: string): (scope: string | null) => string {
  return (scope) => (scope === null ? join(root, 'assistant', 'items.json') : join(dataDir(scope), ATTENTION_FILE))
}
