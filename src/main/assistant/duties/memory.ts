// The memory file of the Assistant (worfy-assistant tickets 07 and 10; ADR-0114, point 2): `<WORFY_DATA_DIR>/assistant/memory.json`,
// in worfy's own data folder (ADR-0005), outside every repository. It keeps the duties as the user set them (modes,
// scope, threshold, on or off), their counters and pause, the rules drawn from dislikes, and the items the counters
// already took (ticket 07); and the open proposals, the Assistant's commitments and the user's answers (ticket 10).
// Only main writes it, through src/main/storage/json-file.ts. Each new Session of the Assistant gets it in its first
// message (src/main/assistant/session/memory.ts) and writes its commitments and the user's answers through `worfy-app`.
//
// Two writers, one file: the duties (Duties, through memoryFileStore) and the Assistant's part (proposals, commitments,
// answers, through sessionMemoryStore). Each write reads the file and keeps the other writer's part as the file has it,
// so the duties' copy in memory never puts back an old list of proposals, and the reverse. main is one thread and both
// read and write the file synchronously, so no write falls between another's read and write.
import { join } from 'node:path'
import { z } from 'zod'
import { dutyActionModeSchema, dutyCountersSchema, memoryRuleSchema, DUTY_ACTIONS } from '../../../shared/assistant/duties'
import { commitmentSchema, userAnswerSchema } from '../../../shared/assistant/memory'
import { assistantProposalSchema } from '../../../shared/assistant/proposals'
import { readJsonFile, writeJsonFile } from '../../storage/json-file'

export const dutyStateSchema = z.object({
  /** The modes the user chose, by action; an action not chosen keeps the duty's default. */
  modes: z.partialRecord(z.enum(DUTY_ACTIONS), dutyActionModeSchema).optional(),
  /** The Projects the duty covers; absent — all. */
  projects: z.array(z.string()).optional(),
  thresholdMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
  enabled: z.boolean().optional(),
  counters: dutyCountersSchema,
  /** Ignored proposals and dislikes in a row; a like or a reaction ends the run. */
  streak: z.number().int().nonnegative(),
  /**
   * The number of the current run: one more each time the run ends (worfy-assistant ticket 14), so taking back a
   * dislike steps back only the run it was in. Absent in a file written before it, which reads as 0.
   */
  run: z.number().int().nonnegative().optional(),
  paused: z.object({ at: z.number(), by: z.enum(['ignored', 'disliked']) }).optional(),
})
export type DutyState = z.infer<typeof dutyStateSchema>

/** What the counters took of one item: when it was first shown, and what became of it. */
export const countedItemSchema = z.object({
  duty: z.string(),
  shownAt: z.number(),
  outcome: z.enum(['accepted', 'declined', 'ignored']).optional(),
})

export const assistantMemorySchema = z.object({
  /** How many ignored proposals or dislikes in a row pause a duty; DEFAULT_PAUSE_AFTER when absent. */
  pauseAfter: z.number().int().min(1).max(100).optional(),
  duties: z.record(z.string(), dutyStateSchema),
  rules: z.array(memoryRuleSchema),
  items: z.record(z.string(), countedItemSchema),
  /** The Assistant's open proposals (ticket 09's ProposalBook keeps them here); absent: none. */
  proposals: z.array(assistantProposalSchema).optional(),
  /** What the Assistant said it would do (ticket 10); absent: none. */
  commitments: z.array(commitmentSchema).optional(),
  /** The user's answers to the Assistant (ticket 10); absent: none. */
  answers: z.array(userAnswerSchema).optional(),
})
export type AssistantMemory = z.infer<typeof assistantMemorySchema>

/** The part of the memory file the Assistant's Session and its proposals write; the duties write the rest. */
export type SessionMemoryPart = Pick<AssistantMemory, 'proposals' | 'commitments' | 'answers'>

const SESSION_KEYS = ['proposals', 'commitments', 'answers'] as const

const sessionPartOf = (memory: AssistantMemory | undefined): SessionMemoryPart =>
  Object.fromEntries(SESSION_KEYS.flatMap((key) => (memory?.[key] === undefined ? [] : [[key, memory[key]]]))) as SessionMemoryPart

const withoutSessionPart = (memory: AssistantMemory): AssistantMemory => {
  const rest = { ...memory }
  for (const key of SESSION_KEYS) delete rest[key]
  return rest
}

const EMPTY_MEMORY: AssistantMemory = { duties: {}, rules: [], items: {} }

export interface MemoryStore {
  read(): AssistantMemory | undefined
  write(memory: AssistantMemory): void
}

/** The memory file under worfy's data root. */
export function assistantMemoryPath(root: string): string {
  return join(root, 'assistant', 'memory.json')
}

/**
 * The duties' store over `file`; an unreadable file is set aside by readJsonFile and reads as no memory. A write keeps
 * the Assistant's part (proposals, commitments, answers) as the file has it, whatever `memory` holds of it.
 */
export function memoryFileStore(file: string): MemoryStore {
  return {
    read: () => readJsonFile(file, assistantMemorySchema),
    write: (memory) => writeJsonFile(file, assistantMemorySchema, { ...withoutSessionPart(memory), ...sessionPartOf(readJsonFile(file, assistantMemorySchema)) }),
  }
}

/** The store of the Assistant's part of the memory file. */
export interface SessionMemoryStore {
  read(): SessionMemoryPart
  /** Writes `part` whole: a key it leaves out is dropped from the file. Throws when the file cannot be written. */
  write(part: SessionMemoryPart): void
}

/** The Assistant's part over `file`: a write keeps the duties' part as the file has it. */
export function sessionMemoryStore(file: string): SessionMemoryStore {
  return {
    read: () => sessionPartOf(readJsonFile(file, assistantMemorySchema)),
    write: (part) => writeJsonFile(file, assistantMemorySchema, { ...withoutSessionPart(readJsonFile(file, assistantMemorySchema) ?? EMPTY_MEMORY), ...sessionPartOf({ ...EMPTY_MEMORY, ...part }) }),
  }
}
