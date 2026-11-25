// The items of a check of a source (worfy-assistant ticket 11; spec, the section on checking sources through claude.ai
// connectors, the output): what one call of Haiku 5.5 over a claude.ai connector answers, and main's check of its form.
// The answer is text a model wrote after reading other people's messages, so nothing in it is trusted: main takes an
// entry only in this form, from the source it asked, with a link it can open, and the Assistant's Session gets it as
// data.
import { z } from 'zod'

/**
 * The most items one answer may carry. When more came, the call reports the oldest ones, the check covers its time only
 * up to the newest of them (SourceItemsCheck.full, CheckRunResult), and the next check reads the rest. Decided
 * without the owner.
 */
export const SOURCE_ITEMS_MAX = 30

const line = (max: number) => z.string().trim().min(1).max(max)

/** One message of a source, as the call reports it. */
export const sourceItemSchema = z
  .object({
    /** The source the call read: the kind of the check (`slack`, `jira`). */
    source: line(40),
    /** The message's id in its source (a Slack channel and timestamp, a Jira issue key and comment). */
    id: line(200),
    author: line(200),
    /** When it was written, ISO 8601 with its offset. */
    at: z.iso.datetime({ offset: true }),
    /** Where the user opens it: an https link. */
    url: z.url({ protocol: /^https$/u }).max(2000),
    /** What it says, short. */
    text: line(500),
    concernsUser: z.boolean(),
    urgent: z.boolean(),
    /** The name of the user's Project it is about; null when none. */
    project: line(200).nullable(),
    /** The Ticket it is about (`<epic>/<NN>`, an issue key); null when none. */
    ticket: line(200).nullable(),
  })
  .strict()
export type SourceItem = z.output<typeof sourceItemSchema>

/** The answer the call is asked for: its items, none when nothing came. */
export const sourceAnswerSchema = z.object({ items: z.array(sourceItemSchema).max(SOURCE_ITEMS_MAX) }).strict()

/** The answer's shape as Claude Code's structured output takes it (SDK option `outputFormat`). */
export function sourceAnswerJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(sourceAnswerSchema, { io: 'input' }) as Record<string, unknown>
}

/** What main takes from an answer: the items that passed, and why each other entry did not. */
export interface SourceItemsCheck {
  /** Oldest first; at most SOURCE_ITEMS_MAX. */
  items: SourceItem[]
  /** One line per entry refused: its number from 1 and the fields that failed; never the entry's text. */
  refused: string[]
  /**
   * The answer reached SOURCE_ITEMS_MAX entries: more may have come than it carried, so it covers its time only up to
   * its newest item taken.
   */
  full: boolean
}

const envelopeSchema = z.object({ items: z.array(z.unknown()) }).strict()

/** The fields of an entry that failed, by their path: the reason without the text a source wrote. */
const fieldsOf = (error: z.ZodError): string => [...new Set(error.issues.map((issue) => (issue.path.length > 0 ? issue.path.join('.') : issue.code)))].join(', ')

/**
 * Checks the form of an answer of the check of `source`. An answer outside the envelope gives null: no item of it is
 * taken. Inside, each entry is checked alone, and one from another source is refused: a message cannot speak for a
 * source it was not read from. Of the entries that pass, the SOURCE_ITEMS_MAX oldest are taken, oldest first: an
 * answer past the cap the schema sets leaves its newer messages to the next check, not lost.
 */
export function sourceItemsOf(answer: unknown, source: string): SourceItemsCheck | null {
  const envelope = envelopeSchema.safeParse(answer)
  if (!envelope.success) return null
  const passed: SourceItem[] = []
  const refused: string[] = []
  envelope.data.items.forEach((entry, index) => {
    const number = index + 1
    const item = sourceItemSchema.safeParse(entry)
    if (!item.success) return void refused.push(`item ${number} fails the form: ${fieldsOf(item.error)}`)
    if (item.data.source !== source) return void refused.push(`item ${number} names another source than ${source}`)
    passed.push(item.data)
  })
  passed.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return { items: passed.slice(0, SOURCE_ITEMS_MAX), refused, full: envelope.data.items.length >= SOURCE_ITEMS_MAX }
}
