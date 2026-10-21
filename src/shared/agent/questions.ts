// Questions with answer options that Claude Code asks with its AskUserQuestion tool (worfy-ui
// ticket 17). What Claude Code does with them was recorded by running its own binary (Agent SDK
// 0.3.289) against a local stand-in of the Messages API (test/contract/ask-user-question-sdk.test.ts):
//
// - it calls canUseTool for AskUserQuestion in every permission mode, bypassPermissions included
//   (the call carries `requiresUserInteraction: true`); without canUseTool the model is not even
//   offered the tool. onUserDialog is not called for it;
// - the answer is `{ behavior: 'allow', updatedInput: { ...input, answers } }`, where `answers` maps
//   each question's text to one string. Claude Code reads a multiSelect answer as labels joined by
//   ", ". When every answer is one of its question's labels the model reads "Your questions have
//   been answered: …"; any other text (the "Other" field) gives "The user answered: … Read the
//   answers carefully …". `allow` without `answers` reads "The user did not answer the questions.";
//   `deny` gives the model the message as the tool's error.
//
// This module holds the shapes both sides share: the questions as the renderer shows them, the
// user's picks as the renderer sends them, and the one place that turns picks into `answers`.
import { z } from 'zod'

/** The name of Claude Code's tool that asks the user questions with answer options. */
export const ASK_USER_QUESTION = 'AskUserQuestion'

/** How Claude Code joins the labels of a multiSelect answer, and splits them again. */
export const MULTI_SELECT_SEPARATOR = ', '

export const questionOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
  /** Shown next to the options when this one is picked or pointed at; markdown (the SDK's default previewFormat). */
  preview: z.string().nullable(),
})
export type QuestionOption = z.output<typeof questionOptionSchema>

export const questionSchema = z.object({
  question: z.string().min(1),
  /** A short label (12 characters in Claude Code's own limit). */
  header: z.string(),
  multiSelect: z.boolean(),
  options: z.array(questionOptionSchema).min(1),
})
export type Question = z.output<typeof questionSchema>

/** The user's answer to one question: the labels picked, and the "Other" text; null: none typed. */
export const questionPickSchema = z.object({
  selected: z.array(z.string().min(1)).max(4),
  other: z.string().max(4000).nullable(),
})
export type QuestionPick = z.output<typeof questionPickSchema>

/** AskUserQuestion's input as the model wrote it (lenient: unknown keys are dropped). */
const inputSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        header: z.string().optional(),
        multiSelect: z.boolean().optional(),
        options: z
          .array(z.object({ label: z.string().min(1), description: z.string().optional(), preview: z.string().optional() }))
          .min(1),
      }),
    )
    .min(1)
    .max(4),
})

/**
 * The questions of an AskUserQuestion input; null when the input is not one worfy can show as
 * questions (the call then goes the ordinary way of a permission request).
 */
export function parseQuestions(input: unknown): Question[] | null {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return null
  const texts = parsed.data.questions.map((each) => each.question)
  // `answers` is keyed by the question's text: two equal texts could not get two answers.
  if (new Set(texts).size !== texts.length) return null
  return parsed.data.questions.map((each) => ({
    question: each.question,
    header: each.header ?? '',
    multiSelect: each.multiSelect === true,
    options: each.options.map((option) => ({ label: option.label, description: option.description ?? '', preview: option.preview ?? null })),
  }))
}

/** Whether a pick answers its question: one choice for a single-choice question, one or more for multiSelect. */
export function pickAnswers(question: Question, pick: QuestionPick | undefined): boolean {
  if (pick === undefined) return false
  const other = pick.other !== null && pick.other.trim() !== '' ? 1 : 0
  const count = pick.selected.length + other
  return question.multiSelect ? count >= 1 : count === 1
}

/**
 * The `answers` Claude Code reads, from the user's picks, one per question in the questions' order.
 * Labels go in the options' order, joined as Claude Code splits them; the "Other" text comes last.
 * Throws when a pick names a label the question does not offer, picks a label twice, or does not
 * answer its question (pickAnswers) — the renderer never sends such a pick, so it is refused, not mended.
 */
export function formatAnswers(questions: readonly Question[], picks: readonly QuestionPick[]): Record<string, string> {
  if (picks.length !== questions.length) throw new Error(`Expected ${questions.length} answers, got ${picks.length}`)
  const answers: Record<string, string> = {}
  questions.forEach((question, index) => {
    const pick = picks[index]!
    const labels = question.options.map((option) => option.label)
    for (const label of pick.selected) if (!labels.includes(label)) throw new Error(`"${label}" is not an option of "${question.question}"`)
    if (new Set(pick.selected).size !== pick.selected.length) throw new Error(`An option of "${question.question}" is picked twice`)
    if (!pickAnswers(question, pick)) throw new Error(`"${question.question}" has no answer`)
    const parts = labels.filter((label) => pick.selected.includes(label))
    if (pick.other !== null && pick.other.trim() !== '') parts.push(pick.other.trim())
    answers[question.question] = parts.join(MULTI_SELECT_SEPARATOR)
  })
  return answers
}
