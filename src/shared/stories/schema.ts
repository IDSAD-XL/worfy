// A Code story (Epic worfy-code-stories): a short step-by-step account of a finished change, for a person
// who has to understand it. Its format is the Harness's, harness/bin/TICKETS.md, sections "Code story" and
// "Story anchor", with the shared cases in harness/bin/tests/fixtures/code-story/. This is the same story as
// data: the shape the invisible agent answers in (ticket 04, the `outputSchema` of the Vendor's oneShot) and
// the one worfy keeps for a story made by the button.
//
// - Steps are code steps (one fragment and the five fields) or frame steps (prose under a fixed title; `What
//   was wrong` carries a Requirement; of the frame steps only `What review found and what remains` quotes
//   fragments: the lines of the head review checked).
// - A story of a PR is its steps; the story of an Epic is Start, one chapter per PR (a chapter not ready yet
//   has `Ready: no — <why>` and no steps), the numbered step "Seams between tickets" with its handoffs
//   (`done: no` keeps its reason), Summary and Check. Both may end with "Check yourself".
// - A reader never refuses a story by its size: no limit on steps.
// - The labels, the frame titles and `not recorded` follow the story's language (labels.json, the table of
//   the fixtures' README); the JSON keys and the values `done`/`ready` are the same in every language.
// - The header is worfy's, not the agent's: worfy knows the Epic, the Ticket, the PR and the language before
//   it asks. A story made by the button is kept outside git, so its header names the PR head it was made
//   from (`commit`, "Story anchor"); an Epic story names the head of each chapter instead.
import { z } from 'zod'
import labelTable from './labels.json'

/** Whose story: one PR's, or a whole Epic's. */
export const STORY_KINDS = ['pr', 'epic'] as const
export const storyKindSchema = z.enum(STORY_KINDS)
export type StoryKind = z.infer<typeof storyKindSchema>

/** `language.reports` of the Profile: a story is in English or in Russian. */
export const STORY_LANGUAGES = ['en', 'ru'] as const
export const storyLanguageSchema = z.enum(STORY_LANGUAGES)
export type StoryLanguage = z.infer<typeof storyLanguageSchema>

export type StoryLabels = (typeof labelTable)['en']

/** The labels, frame titles and section titles of a story in `language`. */
export const storyLabels = (language: StoryLanguage): StoryLabels => labelTable[language]

/** What a field whose reason nobody wrote down says, in `language`: "not recorded". */
export const notRecorded = (language: StoryLanguage): string => storyLabels(language).notRecorded

const text = (description: string) => z.string().min(1).describe(description)
const lineNumber = z.number().int().min(1)
const shaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'a full commit sha')
const ticketNumberSchema = z.string().regex(/^\d{2}$/, 'two digits')

/** A Markdown link, `[text](target)`: what a Requirement holds when it is not "not recorded". */
const MARKDOWN_LINK = /^\[[^\]\n]+\]\([^)\s]+\)$/
/** A place in the code a Check yourself answer points to: `path:line` or `path:from-to`. */
const CODE_PLACE = /^[^\s:]+:\d+(-\d+)?$/

/** A piece of the code: `<path>:<from>-<to>`, the lines themselves and the key lines worfy highlights. */
export const storyFragmentSchema = z
  .object({
    path: text('The file, relative to the repository root, forward slashes.'),
    startLine: lineNumber.describe('The first line of the fragment in the file at the PR head.'),
    endLine: lineNumber.describe('The last line, at or after startLine; a one-line fragment repeats startLine.'),
    keyLines: z.array(lineNumber).min(1).describe('The lines between startLine and endLine that carry the point.'),
    code: text('Lines startLine to endLine exactly as they are in the file, without line numbers.'),
  })
  .strict()
  .superRefine((fragment, context) => {
    if (fragment.endLine < fragment.startLine) context.addIssue({ code: 'custom', path: ['endLine'], message: `endLine ${String(fragment.endLine)} is before startLine ${String(fragment.startLine)}` })
    for (const line of fragment.keyLines) {
      if (line < fragment.startLine || line > fragment.endLine) {
        context.addIssue({ code: 'custom', path: ['keyLines'], message: `key line ${String(line)} is outside ${String(fragment.startLine)}-${String(fragment.endLine)}` })
      }
    }
  })
export type StoryFragment = z.output<typeof storyFragmentSchema>

const requirementText = 'A Markdown link to the section of the Ticket or the spec, relative to the story file; or the "not recorded" word of the language.'

/** A step with one fragment and all five fields. */
export const storyCodeStepSchema = z
  .object({
    kind: z.literal('code'),
    title: text('The heading of the step: one short sentence.'),
    fragment: storyFragmentSchema,
    whatItDoes: text('What the code does.'),
    whyHere: text('Why it is here and not elsewhere; the "not recorded" word when nothing says it.'),
    withoutIt: text('What breaks without it; the "not recorded" word when nothing says it.'),
    requirement: text(requirementText),
    risks: text('Risks and gaps of the tests around it; the "not recorded" word when none are known.'),
  })
  .strict()
export type StoryCodeStep = z.output<typeof storyCodeStepSchema>

/** The fixed titles of the frame steps of every story; an Epic story adds "Seams between tickets" (storySeamsSchema). */
export const STORY_FRAMES = ['wrong', 'notChanged', 'checked', 'review'] as const
export const storyFrameSchema = z.enum(STORY_FRAMES)
export type StoryFrame = z.infer<typeof storyFrameSchema>

/** A step of prose under a fixed title (its words in storyLabels): only `wrong` carries a Requirement. */
export const storyFrameStepSchema = z
  .object({
    kind: z.literal('frame'),
    frame: storyFrameSchema.describe('wrong: what was wrong (the first step); notChanged: what was deliberately not changed; checked: how it was checked; review: what review found and what remains.'),
    text: text('The prose of the step.'),
    requirement: z.string().min(1).nullable().describe(`Only for the frame "wrong", required there: ${requirementText}`),
    fragments: z.array(storyFragmentSchema).describe('Fragments the prose quotes: only the frame "review" quotes any (the lines review checked); every other frame step has none.'),
  })
  .strict()
export type StoryFrameStep = z.output<typeof storyFrameStepSchema>

export const storyStepSchema = z.discriminatedUnion('kind', [storyCodeStepSchema, storyFrameStepSchema])
export type StoryStep = z.output<typeof storyStepSchema>

/** One question of "Check yourself": the answer and the lines that show it. */
export const storyQuestionSchema = z
  .object({
    question: text('A question about a decision, a failure, the data path or the boundary of the change.'),
    answer: text('Its answer.'),
    lines: z.array(z.string().regex(CODE_PLACE, 'path:line or path:from-to')).min(1).describe('Where the answer is seen: path:line or path:from-to.'),
  })
  .strict()
export type StoryQuestion = z.output<typeof storyQuestionSchema>

const checkYourself = z.array(storyQuestionSchema).describe('"Check yourself": two or three questions, or none.')

/** What the agent answers for the story of a PR. */
export const prStoryAnswerSchema = z
  .object({
    steps: z.array(storyStepSchema).min(1).describe('In the order of explanation: "wrong" first, then the code steps, then "notChanged" and "checked" when there is something to say.'),
    checkYourself,
  })
  .strict()
export type PrStoryAnswer = z.output<typeof prStoryAnswerSchema>

/** A handoff between two Tickets of an Epic: `<from> → <to>: <what> · done: yes`, or `done: no — <why>`. */
export const storyHandoffSchema = z
  .object({
    from: ticketNumberSchema.describe('The Ticket that hands over, two digits.'),
    to: ticketNumberSchema.describe('The Ticket that takes it, two digits.'),
    what: text('What is handed over.'),
    done: z.boolean().describe('Whether the receiving Ticket did take it.'),
    why: z.string().min(1).nullable().describe('Why it was dropped: required when done is false, null when it is true.'),
  })
  .strict()
export type StoryHandoff = z.output<typeof storyHandoffSchema>

/** A chapter of an Epic story: `## PR #<N> · <NN> — <title>` with its steps, or `PR -` with `Ready: no — <why>`. */
export const storyChapterSchema = z
  .object({
    ready: z.boolean().describe('False for a Ticket whose PR is not merged yet: no PR, no head, no steps, a why.'),
    pr: z.number().int().positive().nullable(),
    ticket: ticketNumberSchema,
    title: text('The title of the Ticket.'),
    head: shaSchema.nullable().describe("The PR head the chapter's fragments are read against."),
    steps: z.array(storyStepSchema).describe("The steps taken from that PR's story."),
    why: z.string().min(1).nullable().describe('Why the chapter is not ready; null when it is.'),
  })
  .strict()
export type StoryChapter = z.output<typeof storyChapterSchema>

/** The frame step "Seams between tickets" of an Epic story, numbered on from the last step of the chapters. */
export const storySeamsSchema = z
  .object({
    text: text('What the Tickets hand to each other.'),
    handoffs: z.array(storyHandoffSchema),
  })
  .strict()

/** What the agent answers for the story of an Epic. */
export const epicStoryAnswerSchema = z
  .object({
    start: z.object({ text: text('What the Epic set out to fix.'), requirement: text(requirementText) }).strict(),
    chapters: z.array(storyChapterSchema).min(1),
    seams: storySeamsSchema,
    summary: text('What the Epic came to.'),
    check: text('How the Epic as a whole was checked.'),
    checkYourself,
  })
  .strict()
export type EpicStoryAnswer = z.output<typeof epicStoryAnswerSchema>

/** The header of a PR story: the title of the H1, Epic and Ticket together or neither, the PR, the language, the head. */
export const prStoryHeaderSchema = z
  .object({
    title: z.string().min(1),
    epic: z.string().min(1).nullable(),
    ticket: ticketNumberSchema.nullable(),
    pr: z.number().int().positive().nullable(),
    language: storyLanguageSchema,
    /** The PR head the story was made from: it is kept outside git ("Story anchor"). */
    commit: shaSchema,
  })
  .strict()
  .superRefine((header, context) => {
    if ((header.epic === null) !== (header.ticket === null)) context.addIssue({ code: 'custom', path: ['ticket'], message: 'Epic and Ticket go together, or neither does' })
  })
export type PrStoryHeader = z.output<typeof prStoryHeaderSchema>

/** The header of an Epic story; each chapter names its own PR head. */
export const epicStoryHeaderSchema = z.object({ epic: z.string().min(1), language: storyLanguageSchema }).strict()
export type EpicStoryHeader = z.output<typeof epicStoryHeaderSchema>

type Issue = { path: (string | number)[]; message: string }

/** The rules of the format a JSON Schema cannot say, for the answer of `kind` in `language`. */
export function storyIssues(kind: StoryKind, language: StoryLanguage, answer: PrStoryAnswer | EpicStoryAnswer): Issue[] {
  const issues: Issue[] = []
  const missing = notRecorded(language)
  const requirement = (value: string, path: (string | number)[]): void => {
    if (value !== missing && !MARKDOWN_LINK.test(value.trim())) issues.push({ path, message: `not a Markdown link [text](target), nor "${missing}"` })
  }
  const steps = (list: readonly StoryStep[], at: (string | number)[]): void => {
    list.forEach((step, index) => {
      if (step.kind === 'code') requirement(step.requirement, [...at, index, 'requirement'])
      else if (step.frame === 'wrong') {
        if (step.requirement === null) issues.push({ path: [...at, index, 'requirement'], message: `the frame "${storyLabels(language).wrong}" carries a Requirement` })
        else requirement(step.requirement, [...at, index, 'requirement'])
      } else if (step.requirement !== null) issues.push({ path: [...at, index, 'requirement'], message: 'only the frame "wrong" carries a Requirement' })
      if (step.kind === 'frame' && step.frame !== 'review' && step.fragments.length > 0) {
        issues.push({ path: [...at, index, 'fragments'], message: `only the frame "${storyLabels(language).review}" quotes fragments` })
      }
    })
  }
  if (kind === 'pr') steps((answer as PrStoryAnswer).steps, ['steps'])
  else {
    const epic = answer as EpicStoryAnswer
    requirement(epic.start.requirement, ['start', 'requirement'])
    epic.chapters.forEach((chapter, index) => {
      const at = ['chapters', index]
      if (chapter.ready) {
        if (chapter.pr === null) issues.push({ path: [...at, 'pr'], message: 'a ready chapter names its PR' })
        if (chapter.head === null) issues.push({ path: [...at, 'head'], message: 'a ready chapter names its PR head' })
        if (chapter.steps.length === 0) issues.push({ path: [...at, 'steps'], message: 'a ready chapter has steps' })
        if (chapter.why !== null) issues.push({ path: [...at, 'why'], message: 'a ready chapter has no "Ready: no" reason' })
        steps(chapter.steps, [...at, 'steps'])
      } else {
        if (chapter.pr !== null || chapter.head !== null) issues.push({ path: [...at, 'pr'], message: 'a chapter not ready has no PR yet (PR -)' })
        if (chapter.steps.length > 0) issues.push({ path: [...at, 'steps'], message: 'a chapter not ready has no steps' })
        if (chapter.why === null) issues.push({ path: [...at, 'why'], message: 'a chapter not ready says why (Ready: no — <why>)' })
      }
    })
    epic.seams.handoffs.forEach((handoff, index) => {
      if (!handoff.done && handoff.why === null) issues.push({ path: ['seams', 'handoffs', index, 'why'], message: 'a dropped handoff says why (done: no — <why>)' })
      if (handoff.done && handoff.why !== null) issues.push({ path: ['seams', 'handoffs', index, 'why'], message: 'a handoff that was done has no reason' })
    })
  }
  return issues
}

const withLanguageRules =
  (kind: StoryKind) =>
  (story: { header: { language: StoryLanguage } } & (PrStoryAnswer | EpicStoryAnswer), context: z.core.$RefinementCtx): void => {
    for (const issue of storyIssues(kind, story.header.language, story)) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }

const prStorySchema = prStoryAnswerSchema.extend({ kind: z.literal('pr'), header: prStoryHeaderSchema }).strict().superRefine(withLanguageRules('pr'))
const epicStorySchema = epicStoryAnswerSchema.extend({ kind: z.literal('epic'), header: epicStoryHeaderSchema }).strict().superRefine(withLanguageRules('epic'))

/** A story as worfy keeps it: its kind, worfy's header and the agent's answer. */
export const storySchema = z.discriminatedUnion('kind', [prStorySchema, epicStorySchema])
export type Story = z.output<typeof storySchema>

/** The number of the step "Seams between tickets": on from the last step of the chapters. */
export const seamsStepNumber = (answer: EpicStoryAnswer): number => answer.chapters.reduce((count, chapter) => count + chapter.steps.length, 0) + 1

const answerSchema = (kind: StoryKind) => (kind === 'pr' ? prStoryAnswerSchema : epicStoryAnswerSchema)

/**
 * The JSON Schema of the answer of `kind`, for the `outputSchema` of a oneShot. Without `$schema`: Claude
 * Code refuses a structured output whose schema carries it (see sessionSchema of src/main/projects/connect.ts).
 */
export function storyOutputSchema(kind: StoryKind): Record<string, unknown> {
  const schema = z.toJSONSchema(answerSchema(kind), { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  delete schema.$schema
  return schema
}

export type StoryAnswerOf<K extends StoryKind> = K extends 'pr' ? PrStoryAnswer : EpicStoryAnswer

/** The answer read against the format: the story's body, or the reason it does not fit, path by path. */
export function readStoryAnswer<K extends StoryKind>(kind: K, language: StoryLanguage, value: unknown): { ok: true; answer: StoryAnswerOf<K> } | { ok: false; reason: string } {
  const parsed = answerSchema(kind).safeParse(value)
  const issues: Issue[] = parsed.success
    ? storyIssues(kind, language, parsed.data)
    : parsed.error.issues.map((issue) => ({ path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)), message: issue.message }))
  if (parsed.success && issues.length === 0) return { ok: true, answer: parsed.data as StoryAnswerOf<K> }
  const shown = issues.slice(0, 5).map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'the answer'}: ${issue.message}`)
  const more = issues.length - shown.length
  return { ok: false, reason: `${shown.join('; ')}${more > 0 ? `; and ${String(more)} more` : ''}` }
}
