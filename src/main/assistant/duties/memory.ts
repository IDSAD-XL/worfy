// The memory file of the Assistant (worfy-assistant ticket 07; ADR-0114, point 2): `<WORFY_DATA_DIR>/assistant/memory.json`,
// in worfy's own data folder (ADR-0005), outside every repository. It keeps the duties as the user set them (modes,
// scope, threshold, on or off), their counters and pause, the rules drawn from dislikes, and the items the counters
// already took. Only main writes it, through src/main/storage/json-file.ts. The Session of the Assistant (ticket 10)
// reads it through `worfy-app` (ticket 09).
import { join } from 'node:path'
import { z } from 'zod'
import { dutyActionModeSchema, dutyCountersSchema, memoryRuleSchema, DUTY_ACTIONS } from '../../../shared/assistant/duties'
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
})
export type AssistantMemory = z.infer<typeof assistantMemorySchema>

export interface MemoryStore {
  read(): AssistantMemory | undefined
  write(memory: AssistantMemory): void
}

/** The memory file under worfy's data root. */
export function assistantMemoryPath(root: string): string {
  return join(root, 'assistant', 'memory.json')
}

/** The store over `file`; an unreadable file is set aside by readJsonFile and reads as no memory. */
export function memoryFileStore(file: string): MemoryStore {
  return {
    read: () => readJsonFile(file, assistantMemorySchema),
    write: (memory) => writeJsonFile(file, assistantMemorySchema, memory),
  }
}
