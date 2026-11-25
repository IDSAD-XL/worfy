// The items of a check of a source (worfy-assistant ticket 11; spec, the section on checking sources through claude.ai
// connectors, the output): what one call of Haiku 5.5 over a claude.ai connector answers, and main's check of its form.
// The answer is text a model wrote after reading other people's messages, so nothing in it is trusted: main takes an
// entry only in this form, from the source it asked, with a link it can open, and the Assistant's Session gets it as
// data.
import { z } from 'zod'

/** The most items one answer may carry: the rest of a busy hour waits for the next check. Decided without the owner. */
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
  items: SourceItem[]
  /** One line per entry refused: its number from 1 and the fields that failed; never the entry's text. */
  refused: string[]
}

const envelopeSchema = z.object({ items: z.array(z.unknown()) }).strict()

/** The fields of an entry that failed, by their path: the reason without the text a source wrote. */
const fieldsOf = (error: z.ZodError): string => [...new Set(error.issues.map((issue) => (issue.path.length > 0 ? issue.path.join('.') : issue.code)))].join(', ')

/**
 * Checks the form of an answer of the check of `source`. An answer outside the envelope gives null: no item of it is
 * taken. Inside, each entry is checked alone, and one from another source is refused: a message cannot speak for a
 * source it was not read from. Entries past SOURCE_ITEMS_MAX are refused too.
 */
export function sourceItemsOf(answer: unknown, source: string): SourceItemsCheck | null {
  const envelope = envelopeSchema.safeParse(answer)
  if (!envelope.success) return null
  const check: SourceItemsCheck = { items: [], refused: [] }
  envelope.data.items.forEach((entry, index) => {
    const number = index + 1
    if (index >= SOURCE_ITEMS_MAX) return void check.refused.push(`item ${number} is past the ${SOURCE_ITEMS_MAX} an answer may carry`)
    const item = sourceItemSchema.safeParse(entry)
    if (!item.success) return void check.refused.push(`item ${number} fails the form: ${fieldsOf(item.error)}`)
    if (item.data.source !== source) return void check.refused.push(`item ${number} names another source than ${source}`)
    check.items.push(item.data)
  })
  return check
}
