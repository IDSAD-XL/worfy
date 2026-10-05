// The slash commands and skills of a Session (ticket 20), as the input field's slash menu lists
// them. main gathers them from Claude Code (src/main/agent/commands.ts); the renderer filters them
// by what the user types (src/renderer/session/SlashMenu.tsx).
import { z } from 'zod'

export const slashCommandSchema = z.object({
  /** Without the leading slash: `ship-ticket`. */
  name: z.string().min(1),
  /** Empty when Claude Code gives none. */
  description: z.string(),
  /** What the command takes after its name, such as `<file>`; empty when nothing. */
  argumentHint: z.string(),
  /** A skill (from ~/.claude, the Project or a plugin) or another command. */
  kind: z.enum(['skill', 'command']),
})
export type SlashCommand = z.output<typeof slashCommandSchema>
