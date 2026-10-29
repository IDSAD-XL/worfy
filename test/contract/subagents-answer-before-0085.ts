// The output schema of `claudeHome.subagents` as main had it on 2026-10-29 (origin/main 66332f0e,
// src/shared/transcript/subagents.ts and src/shared/ipc/claude-home.ts), copied as it was: what a
// Linked machine of that build checks an answer against (src/main/link/remote-calls.ts). A newer
// build's answer must still pass it, or the older peer refuses the whole tree (ADR-0079, ADR-0085).
// Never update this copy to the current schema: it stands for the older build.
import { z } from 'zod'

const TEXT_MAX = 4000
const SHORT_MAX = 500
const time = z.number().nullable()
const short = z.string().max(SHORT_MAX).nullable()
const long = z.string().max(TEXT_MAX).nullable()

/** One fact about a Subagent from a stream of events. `at`: ms since the epoch, when known. */
export const subagentSignalSchema = z.discriminatedUnion('kind', [
  /** The Agent tool was called; `parentToolUseId` is set when a Subagent made the call (live SDK events). */
  z.object({
    kind: z.literal('call'),
    toolUseId: z.string(),
    at: time,
    parentToolUseId: z.string().nullable(),
    subagentType: short,
    description: short,
    name: short,
    model: short,
    background: z.boolean(),
  }),
  /** The Workflow tool was called: a workflow script runs in the background; `name` is the script's. */
  z.object({ kind: z.literal('workflow'), toolUseId: z.string(), at: time, name: short }),
  /** The Agent tool's result: the Subagent's answer, or "launched" for one that runs in the background. Also the Workflow tool's. */
  z.object({ kind: z.literal('result'), toolUseId: z.string(), at: time, text: z.string().max(TEXT_MAX), isError: z.boolean(), launched: z.boolean() }),
  z.object({ kind: z.literal('started'), agentId: z.string(), toolUseId: z.string().nullable(), at: time, subagentType: short, description: short }),
  /** A task-notification (or a synchronous call's result) says the Subagent ended. */
  z.object({ kind: z.literal('finished'), agentId: z.string(), toolUseId: z.string().nullable(), at: time, status: short, summary: short, result: long }),
  /**
   * The Session's Claude Code process is not running (main reads `sessions/<pid>.json`): its
   * Subagents live in that process, so one that has not ended by now never will (ADR-0031).
   * Counts only among the Session's own signals.
   */
  z.object({ kind: z.literal('session-closed') }),
])

const loose = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)

/** `agent-<id>.meta.json`, read leniently: a field of another type is left out, unknown fields are dropped. */
export const subagentMetaSchema = z.object({
  agentType: loose(z.string().max(SHORT_MAX)),
  description: loose(z.string().max(SHORT_MAX)),
  name: loose(z.string().max(SHORT_MAX)),
  model: loose(z.string().max(SHORT_MAX)),
  toolUseId: loose(z.string().max(SHORT_MAX)),
  parentAgentId: loose(z.string().max(SHORT_MAX)),
  /** `foreground` or `background`. */
  requestShape: loose(z.string().max(SHORT_MAX)),
  spawnDepth: loose(z.number().int().nonnegative()),
  /** The user stopped the Subagent: it ends without a task-notification. */
  stoppedByUser: loose(z.boolean()),
})

/** What one Subagent's files say. */
export const subagentFileSchema = z.object({
  agentId: z.string(),
  meta: subagentMetaSchema.nullable(),
  /** `agent-<id>.jsonl` exists (the transcript can be opened). */
  transcript: z.boolean(),
  /** Times of the first and the last record that has one. */
  firstAt: time,
  lastAt: time,
  /** The model of its last answer. */
  model: short,
  /** Text of its last answer. */
  finalText: long,
  /** Its last record is an answer that ended the turn (`stop_reason: end_turn`). */
  ended: z.boolean(),
  /** Its own calls of the Agent tool and what came of them. */
  signals: z.array(subagentSignalSchema),
  /** Set for an agent of a workflow script: its run, and what the run's journal says about it. */
  workflow: z
    .object({
      runId: z.string().max(SHORT_MAX),
      /** `label` of its `started` record (`impl:03`); older journals have none. */
      label: short,
      phase: short,
      /** `completed` after a `result` record, `failed` after a `failed` one. */
      end: z.enum(['completed', 'failed']).nullable(),
      /** Its result when it is text, or the `summary` of a structured one. */
      result: long,
    })
    .nullable(),
})

export const subagentsAnswerSchema = z.object({ found: z.boolean(), signals: z.array(subagentSignalSchema), files: z.array(subagentFileSchema), truncated: z.boolean().optional() })
