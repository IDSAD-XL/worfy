// A Code story (Epic worfy-code-stories): a short step-by-step account of a finished change, for a person
// who has to understand it. The shape here is the one the invisible agent answers in (worfy-code-stories
// ticket 04: the `outputSchema` of the Vendor's oneShot) and the one worfy keeps. The fields follow the
// format of the spec (section "Implementation decisions" → Harness → "Format"): a header without a commit, steps in the
// order of the explanation, and for the story of an Epic the list of hand-overs between its Tickets.
//
// The header is not the agent's to write: worfy knows the Epic, the Ticket, the PR and the language before
// it asks, so the agent answers the steps (storyAnswerSchema) and worfy puts the header on top (Story).
import { z } from 'zod'

/** Whose story: one PR's, or a whole Epic's. */
export const STORY_KINDS = ['pr', 'epic'] as const
export const storyKindSchema = z.enum(STORY_KINDS)
export type StoryKind = z.infer<typeof storyKindSchema>

/** The most steps a story has: up to ten main ones (spec, owner decision 8), plus the hand-overs step and the review step. */
export const STORY_MAX_STEPS = 12

/** What the agent writes into a field it has nothing for (spec, the format: a field without a reason says so). */
export const NOT_RECORDED = 'not recorded'

const text = (description: string) => z.string().min(1).describe(description)
const lineNumber = z.number().int().min(1)

/** A piece of the code of the change: `path:start-end`, the code itself and the lines that matter most. */
export const storyFragmentSchema = z
  .object({
    path: text('The file, relative to the repository root, forward slashes.'),
    startLine: lineNumber.describe('The first line of the fragment in the file after the change.'),
    endLine: lineNumber.describe('The last line of the fragment, at or after startLine.'),
    mainLines: z.array(lineNumber).describe('The lines between startLine and endLine that carry the point of the step.'),
    code: text('The lines startLine to endLine as they are in the file, without line numbers.'),
  })
  .strict()
  .superRefine((fragment, context) => {
    if (fragment.endLine < fragment.startLine) context.addIssue({ code: 'custom', path: ['endLine'], message: `endLine ${String(fragment.endLine)} is before startLine ${String(fragment.startLine)}` })
    for (const line of fragment.mainLines) {
      if (line < fragment.startLine || line > fragment.endLine) {
        context.addIssue({ code: 'custom', path: ['mainLines'], message: `main line ${String(line)} is outside ${String(fragment.startLine)}-${String(fragment.endLine)}` })
      }
    }
  })
export type StoryFragment = z.output<typeof storyFragmentSchema>

/** One step: a heading and the fields of the format; a step without code (what was left alone, how it was checked) has no fragment. */
export const storyStepSchema = z
  .object({
    title: text('The heading of the step: one short sentence.'),
    fragment: storyFragmentSchema.nullable().describe('The code the step explains; null for a step without code.'),
    what: text('What the code does. "not recorded" when nothing says it.'),
    why: text('Why it is here and not elsewhere. "not recorded" when nothing says it.'),
    without: text('What breaks without it. "not recorded" when nothing says it.'),
    requirement: text('The section of the Ticket or the spec this step answers. "not recorded" when none.'),
    risks: text('Risks and gaps of the tests around this step. "not recorded" when none are known.'),
  })
  .strict()
export type StoryStep = z.output<typeof storyStepSchema>

/** A hand-over between two Tickets of an Epic, for the step about the seams between them. */
export const storyHandoffSchema = z
  .object({
    from: text('The Ticket that hands over, by its number.'),
    to: text('The Ticket that takes it, by its number.'),
    what: text('What is handed over.'),
    done: z.boolean().describe('Whether the receiving Ticket did take it.'),
  })
  .strict()
export type StoryHandoff = z.output<typeof storyHandoffSchema>

/** What the agent answers: the steps, and the hand-overs (empty for the story of a PR). */
export const storyAnswerSchema = z
  .object({
    steps: z.array(storyStepSchema).min(1).max(STORY_MAX_STEPS).describe('The steps in the order of the explanation: first what was wrong, last what was left alone and how it was checked.'),
    handoffs: z.array(storyHandoffSchema).describe('The hand-overs between Tickets; empty for the story of one PR.'),
  })
  .strict()
export type StoryAnswer = z.output<typeof storyAnswerSchema>

/** The header worfy puts on a story: no commit (spec, owner decision 24). */
export const storyHeaderSchema = z
  .object({
    kind: storyKindSchema,
    epic: z.string().min(1).nullable(),
    ticket: z.string().min(1).nullable(),
    pr: z.number().int().positive().nullable(),
    /** `language.reports` of the Profile (spec, owner decision 10). */
    language: z.string().min(2).max(35),
  })
  .strict()
export type StoryHeader = z.output<typeof storyHeaderSchema>

export const storySchema = storyAnswerSchema.extend({ header: storyHeaderSchema }).strict()
export type Story = z.output<typeof storySchema>

/**
 * The JSON Schema of the answer, for the `outputSchema` of a oneShot. Without `$schema`: Claude Code
 * refuses a structured output whose schema carries it (see sessionSchema of src/main/projects/connect.ts).
 */
export function storyOutputSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(storyAnswerSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  delete schema.$schema
  return schema
}

/** The answer read against the schema: the story's steps, or the reason it does not fit, path by path. */
export function readStoryAnswer(value: unknown): { ok: true; answer: StoryAnswer } | { ok: false; reason: string } {
  const parsed = storyAnswerSchema.safeParse(value)
  if (parsed.success) return { ok: true, answer: parsed.data }
  const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'the answer'}: ${issue.message}`)
  const more = parsed.error.issues.length - issues.length
  return { ok: false, reason: `${issues.join('; ')}${more > 0 ? `; and ${String(more)} more` : ''}` }
}
