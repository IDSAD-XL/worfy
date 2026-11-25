// The proposals of the Assistant (worfy-assistant ticket 09; spec, the MCP server `worfy-app`; stories 21 and 22): what the
// Assistant offers the user — a step to take, with why — and, for Prepare, the exact text of the Session it would start.
// The Assistant creates, updates and removes them through `worfy-app` (src/main/mcp/app-server.ts); main keeps them
// (src/main/assistant/proposals/book.ts); the window shows them with Dismiss, Snooze, Open and Prepare (ticket 14). A
// Session with a text the Assistant wrote starts only on the user's click, after the user has seen that text (ADR-0114,
// boundary 3): nothing here starts one.
import { z } from 'zod'

/** The longest title of a proposal. */
export const PROPOSAL_TITLE_MAX = 200
/** The longest «why» of a proposal. */
export const PROPOSAL_WHY_MAX = 2_000
/** The longest text of a prepared Session. */
export const PREPARE_TEXT_MAX = 20_000

const filled = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim() !== '', 'must not be empty or blanks only')

export const proposalTitleSchema = filled(PROPOSAL_TITLE_MAX)
export const proposalWhySchema = filled(PROPOSAL_WHY_MAX)

/** Prepare: the Session the user may start, in a Project of this Machine, with exactly this text. */
export const preparedSessionSchema = z.object({ projectId: z.string().min(1), text: filled(PREPARE_TEXT_MAX) })
export type PreparedSession = z.infer<typeof preparedSessionSchema>

export const assistantProposalSchema = z.object({
  id: z.string().min(1),
  title: proposalTitleSchema,
  why: proposalWhySchema,
  /** The item of the attention core it answers; null for a proposal of no item (one the user asked for). */
  item: z.string().nullable(),
  prepare: preparedSessionSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type AssistantProposal = z.infer<typeof assistantProposalSchema>
