// The Assistant's journal of actions (worfy-assistant ticket 08; ADR-0114, point 4 and boundary 6):
// `<WORFY_DATA_DIR>/assistant/journal.json`, in worfy's own data folder (ADR-0005), outside every repository. Each action
// of the closed list — done, refused or escalated — is one line with the item that caused it. Only main writes it,
// through src/main/storage/json-file.ts; the window (ticket 14) and `worfy-app` (ticket 09) read it.
import { join } from 'node:path'
import { z } from 'zod'
import { actionJournalLineSchema, type ActionJournalLine } from '../../../shared/assistant/actions'
import { readJsonFile, writeJsonFile } from '../../storage/json-file'

/**
 * How long a line is kept: 14 days, the keep of the items of the attention core (ATTENTION_KEEP_DAYS), so a line never
 * outlives the item it names by long. Decided without the owner (ticket 08, result section).
 */
export const JOURNAL_KEEP_MS = 14 * 24 * 60 * 60_000

export const actionJournalFileSchema = z.object({ lines: z.array(actionJournalLineSchema) })

export interface ActionJournal {
  append(line: ActionJournalLine): void
  /** The lines, oldest first. */
  lines(): ActionJournalLine[]
}

/** The journal file under worfy's data root. */
export function actionJournalPath(root: string): string {
  return join(root, 'assistant', 'journal.json')
}

/**
 * The journal over `file`: a line older than JOURNAL_KEEP_MS leaves it at the next write. An unreadable file is set
 * aside by readJsonFile and the journal starts afresh; a write that fails throws to the caller.
 */
export function actionJournalFile(file: string, now: () => number): ActionJournal {
  const read = (): ActionJournalLine[] => readJsonFile(file, actionJournalFileSchema)?.lines ?? []
  return {
    append: (line) => {
      const oldest = now() - JOURNAL_KEEP_MS
      writeJsonFile(file, actionJournalFileSchema, { lines: [...read().filter((each) => each.at >= oldest), line] })
    },
    lines: read,
  }
}

/** A journal in memory, for tests and for a store that cannot write. */
export function memoryActionJournal(): ActionJournal {
  const kept: ActionJournalLine[] = []
  return { append: (line) => void kept.push(structuredClone(line)), lines: () => structuredClone(kept) }
}
