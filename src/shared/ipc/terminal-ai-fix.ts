// The `terminalAi.fix` domain: the "Fix" button in the header of a Terminal Node
// (src/renderer/canvas/nodes/TerminalNode.tsx; Epic worfy-terminal-ai, ticket 07). Handled in
// src/main/ipc/terminal-ai-fix.ts.
//
// Every channel here is `project` (src/shared/ipc/channels.ts): Fix works with a Terminal of the
// Project, not with the desktop of its Machine. From the screen of a Linked machine, while its access
// is on, the button works too, and the Machine of the Terminal asks the model on its own subscription
// and within its own Limits (owner's decision 8(a)).
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

const terminalRef = {
  projectId: z.string().min(1),
  nodeId: z.string().min(1).max(200),
}

export const terminalAiFixStateSchema = z.object({
  /**
   * The last command of the Terminal ended with an exit code other than 0, no command started
   * since, its line is known (it did not start with a space), the zsh is connected to Terminal AI
   * and Fix is on in Settings.
   */
  available: z.boolean(),
})
export type TerminalAiFixState = z.output<typeof terminalAiFixStateSchema>

/** The state of the button of one Terminal; the calling client then gets `terminalAi.fix.changed` for it. */
export const terminalAiFixState = invokeChannel('terminalAi.fix.state', z.object(terminalRef), terminalAiFixStateSchema, 'project')

/** The new state of the button of a Terminal: a command failed or started, the zsh connected or left, Settings changed, a Fix landed. */
export const terminalAiFixChanged = eventChannel('terminalAi.fix.changed', z.object({ ...terminalRef, ...terminalAiFixStateSchema.shape }), 'project')

export const terminalAiFixResultSchema = z.discriminatedUnion('ok', [
  /** The corrected command is in the line of the shell; nothing ran. */
  z.object({ ok: z.literal(true) }),
  /** Nothing was put into the line; `message` says why, for the header ("Limits reached until 14:20"). */
  z.object({ ok: z.literal(false), message: z.string() }),
])
export type TerminalAiFixResult = z.output<typeof terminalAiFixResultSchema>

/** Asks the model to correct the failed command of the Terminal and puts the answer into the line of its shell. It never runs. */
export const terminalAiFixRun = invokeChannel('terminalAi.fix.run', z.object(terminalRef), terminalAiFixResultSchema, 'project')

declare module './channels' {
  interface IpcContract {
    'terminalAi.fix.state': typeof terminalAiFixState
    'terminalAi.fix.changed': typeof terminalAiFixChanged
    'terminalAi.fix.run': typeof terminalAiFixRun
  }
}
