// The `terminalAi.request` domain: the ⌘I panel of Command request over a Terminal Node
// (src/renderer/canvas/nodes/TerminalAiRequest.tsx; Epic worfy-terminal-ai, ticket 06). Handled in
// src/main/ipc/terminal-ai-request.ts.
//
// Every channel here is `project` (src/shared/ipc/channels.ts): the panel works with a Terminal of
// the Project, not with the desktop of its Machine. From the screen of a Linked machine, while its
// access is on, it works as the line `# …` does, and the Machine of the Terminal asks the model on
// its own subscription and within its own Limits (owner's decision 8(a)).
import { z } from 'zod'
import { MAX_FIELD_CHARS } from '../terminal-ai/context'
import { eventChannel, invokeChannel } from './channels'

const terminalRef = {
  projectId: z.string().min(1),
  nodeId: z.string().min(1).max(200),
}

/** The longest request in words the panel sends. */
export const MAX_REQUEST_CHARS = 2000

export const terminalAiRequestStateSchema = z.object({
  /** The zsh of the Terminal is connected to Terminal AI and Command request is on in Settings. */
  available: z.boolean(),
  /** A command runs in the Terminal: what is typed there now is that command's. */
  busy: z.boolean(),
})
export type TerminalAiRequestState = z.output<typeof terminalAiRequestStateSchema>

/** The state of the panel of one Terminal; the calling client then gets `terminalAi.request.changed` for it. */
export const terminalAiRequestState = invokeChannel('terminalAi.request.state', z.object(terminalRef), terminalAiRequestStateSchema, 'project', 'read')

/** The new state of the panel of a Terminal: its zsh connected or left, a command started or ended, Settings changed. */
export const terminalAiRequestChanged = eventChannel('terminalAi.request.changed', z.object({ ...terminalRef, ...terminalAiRequestStateSchema.shape }), 'project', 'read')

export const terminalAiRequestResultSchema = z.discriminatedUnion('ok', [
  /** The command is in the line of the shell; nothing ran. */
  z.object({ ok: z.literal(true) }),
  /** Nothing was put into the line; `message` says why, for the panel ("Limits reached until 14:20"). */
  z.object({ ok: z.literal(false), message: z.string() }),
])
export type TerminalAiRequestResult = z.output<typeof terminalAiRequestResultSchema>

/**
 * Asks the model for a command for `text` and puts it into the line of the Terminal's shell. It
 * never runs. Fails (an error, the model not asked) for a Terminal whose zsh is not connected.
 *
 * `line` is what is typed in the line of the shell when the panel asks, as the screen of the
 * Terminal shows it (src/renderer/canvas/nodes/terminal-line.ts): it goes into the context of the
 * request, redacted, and not at all when it starts with a space (prepareContext of
 * src/shared/terminal-ai/context.ts). The screen may be forged by a program that prints the mark of
 * the end of the prompt: that changes only this text of the context. Absent — an empty line.
 */
export const terminalAiRequest = invokeChannel(
  'terminalAi.request',
  z.object({ ...terminalRef, text: z.string().trim().min(1).max(MAX_REQUEST_CHARS), line: z.string().max(MAX_FIELD_CHARS).default('') }),
  terminalAiRequestResultSchema,
  'project',
  'write',
)

/** The panel was closed while its request waited: the request is cancelled and nothing is put into the line. */
export const terminalAiRequestCancel = invokeChannel('terminalAi.request.cancel', z.object(terminalRef), z.void(), 'project', 'write')

declare module './channels' {
  interface IpcContract {
    'terminalAi.request.state': typeof terminalAiRequestState
    'terminalAi.request.changed': typeof terminalAiRequestChanged
    'terminalAi.request': typeof terminalAiRequest
    'terminalAi.request.cancel': typeof terminalAiRequestCancel
  }
}
