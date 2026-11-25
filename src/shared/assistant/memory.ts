// The part of the Assistant's memory file its Session writes (worfy-assistant ticket 10; ADR-0114, point 2; spec, the
// Session of the Assistant): its commitments — what it said it would do or look at again — and the user's answers to
// its questions. The memory file (src/main/assistant/duties/memory.ts) keeps them next to the duties, the rules drawn
// from dislikes and the open proposals; each new Session of the Assistant gets the whole of it in its first message.
//
// The Session writes them only through `worfy-app` (memory_note, memory_forget): it has no tool that writes a file.
import { z } from 'zod'

/** The most commitments the memory keeps; a new one past it is refused until one is forgotten. */
export const COMMITMENTS_MAX = 50
/** The most answers of the user the memory keeps. */
export const ANSWERS_MAX = 100
/** The longest text of a commitment. */
export const COMMITMENT_TEXT_MAX = 500
/** The longest topic of an answer: its key, a new answer on the same topic replaces the old one. */
export const ANSWER_TOPIC_MAX = 100
/** The longest text of an answer. */
export const ANSWER_TEXT_MAX = 2_000

const filled = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim() !== '', 'must not be empty or blanks only')

export const commitmentTextSchema = filled(COMMITMENT_TEXT_MAX)
export const answerTopicSchema = filled(ANSWER_TOPIC_MAX)
export const answerTextSchema = filled(ANSWER_TEXT_MAX)

/** What the Assistant said it would do: «look at PR 12 again after its CI», with when, if it said. */
export const commitmentSchema = z.object({
  id: z.string().min(1),
  text: commitmentTextSchema,
  /** When it is due, in milliseconds since the epoch; null when the Assistant named no time. */
  due: z.number().nullable(),
  at: z.number(),
})
export type Commitment = z.infer<typeof commitmentSchema>

/** What the user answered the Assistant: the topic it asked about and the answer in the user's own words. */
export const userAnswerSchema = z.object({
  id: z.string().min(1),
  topic: answerTopicSchema,
  text: answerTextSchema,
  at: z.number(),
})
export type UserAnswer = z.infer<typeof userAnswerSchema>
