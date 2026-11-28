// The proposals of the Assistant (worfy-assistant ticket 09; spec, the MCP server `worfy-app`; stories 21 and 22): what the
// Assistant offers the user — a step to take, with why — and, for Prepare, the exact text of the Session it would start.
// The Assistant creates, updates and removes them through `worfy-app` (src/main/mcp/app-server.ts); main keeps them
// (src/main/assistant/proposals/book.ts); the window shows them with Dismiss, Snooze, Open and Prepare (ticket 14). A
// Session with a text the Assistant wrote starts only on the user's click, after the user has seen that text (ADR-0114,
// boundary 3): nothing here starts one. A proposal may also carry a change of the Assistant's settings (ticket 15,
// settings-change.ts): the card «before → after»; nothing applies it but the user's Apply, which notes when (`applied`),
// and the user's Undo takes it back (ticket 25).
import { z } from 'zod'
import { changeRowSchema, settingsChangeSchema, settingsRestoreSchema } from './settings-change'

/** The longest title of a proposal. */
export const PROPOSAL_TITLE_MAX = 200
/** The longest «why» of a proposal. */
export const PROPOSAL_WHY_MAX = 2_000
/** The longest why of a proposal the Assistant closed (`proposal_remove` with `why`, worfy-polish 172). */
export const PROPOSAL_CLOSE_WHY_MAX = 200
/** How long the book keeps a proposal the Assistant closed: as long as the attention core keeps an item. */
export const PROPOSAL_CLOSED_KEEP_DAYS = 14
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
  /** A change of the Assistant's settings the user may apply (ticket 15); absent or null: none. */
  change: settingsChangeSchema.nullable().optional(),
  /**
   * When the user applied the change, and its rows as they were then; absent or null: not applied (or undone). `before`:
   * each setting it named as it was before the Apply, for Undo (ticket 25); absent for one applied before Undo existed.
   */
  applied: z.object({ at: z.number(), rows: z.array(changeRowSchema), before: settingsRestoreSchema.optional() }).nullable().optional(),
  /**
   * The Assistant closed it on a wake, having read that what it asked was done (worfy-polish 172: `proposal_remove`
   * with `why`): when, by whom and why. A closed proposal is no longer open — the window, `proposals_list` and the first
   * message of a Session leave it out — and the book keeps it PROPOSAL_CLOSED_KEEP_DAYS. Absent or null: open.
   */
  closed: z.object({ at: z.number(), by: z.literal('assistant'), why: z.string() }).nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type AssistantProposal = z.infer<typeof assistantProposalSchema>
