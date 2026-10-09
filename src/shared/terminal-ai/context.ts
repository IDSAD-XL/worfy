// What a Terminal AI request sends to the model (ADR-0058, point 5), and the text the model reads.
//
// The context is the input line, the folder, up to MAX_COMMANDS last commands of this Terminal, the
// git branch and the exit code of the last command; Fix also gets up to MAX_OUTPUT_LINES last lines
// of the failed command's output. Nothing else: there is no field for environment variables.
//
// prepareContext() trims and redacts every field (src/shared/terminal-ai/redact.ts) before
// contextText() builds the text, and drops a line or a command that starts with a space: such a
// command stays out of the shell history, and stays out of the model too. The signs "a command is
// running" and "alternate screen" are carried to the service, which sends nothing while either is
// set (owner's decision 3; Tickets 01 and 03 give the data).
import { z } from 'zod'
import { redactSecrets } from './redact'
import type { TerminalAiFeature } from './settings'

export const MAX_COMMANDS = 20
export const MAX_OUTPUT_LINES = 50
/** A field longer than this is cut: no command line is that long, a pasted file is not context. */
export const MAX_FIELD_CHARS = 2000

/** What the shell knows when a request is made (the socket of Ticket 03 sends it). */
export const terminalAiInputSchema = z.object({
  /** The input line as typed so far. */
  line: z.string(),
  /** The words of a Command request (`# …` or the Cmd+I panel); absent for other features. */
  request: z.string().optional(),
  /** The Terminal's folder. */
  cwd: z.string(),
  /** The last commands of this Terminal, oldest first. */
  commands: z.array(z.string()),
  /** The git branch of `cwd`; main finds it (src/main/terminal-ai/git-branch.ts) when absent. */
  branch: z.string().nullable().optional(),
  /** The exit code of the last command; null when unknown. */
  exitCode: z.number().int().nullable(),
  /** The output of the last command, its last lines; only Fix sends it. */
  output: z.array(z.string()).optional(),
  /** A command is running: what is typed now may be a password for sudo or ssh. */
  commandRunning: z.boolean(),
  /** A full-screen program (vim, less) holds the Terminal. */
  alternateScreen: z.boolean(),
})
export type TerminalAiInput = z.infer<typeof terminalAiInputSchema>

/** The context as the model gets it: trimmed, redacted, without private lines. */
export interface TerminalAiContext {
  line: string
  request: string | null
  cwd: string
  commands: string[]
  branch: string | null
  exitCode: number | null
  /** Only for Fix; null otherwise. */
  output: string[] | null
}

/** A line the user kept out of the history by starting it with a space. */
export const isPrivateLine = (text: string): boolean => /^[ \t]/.test(text)

const field = (text: string): string => redactSecrets(text.length > MAX_FIELD_CHARS ? text.slice(0, MAX_FIELD_CHARS) : text)

/** The context of `feature` out of what the shell knows; `branch` is the one main found. */
export function prepareContext(feature: TerminalAiFeature, input: TerminalAiInput, branch: string | null = input.branch ?? null): TerminalAiContext {
  const commands = input.commands.filter((command) => command.trim() !== '' && !isPrivateLine(command)).slice(-MAX_COMMANDS)
  // Redaction runs over the whole tail, so a secret that spans lines (a key block) goes as a whole.
  const output = feature === 'fix' && input.output !== undefined ? redactSecrets(input.output.slice(-MAX_OUTPUT_LINES).join('\n')).split('\n') : null
  return {
    line: isPrivateLine(input.line) ? '' : field(input.line),
    request: input.request === undefined ? null : field(input.request),
    cwd: field(input.cwd),
    commands: commands.map(field),
    branch: branch === null ? null : field(branch),
    exitCode: input.exitCode,
    output,
  }
}

/** The user message of a request: the context, labelled, one field per block. */
export function contextText(feature: TerminalAiFeature, context: TerminalAiContext): string {
  const parts: string[] = [`Folder: ${context.cwd}`]
  if (context.branch !== null) parts.push(`Git branch: ${context.branch}`)
  if (context.commands.length > 0) parts.push(`Recent commands, oldest first:\n${context.commands.map((command) => `  ${command}`).join('\n')}`)
  if (context.exitCode !== null) parts.push(`Exit code of the last command: ${context.exitCode}`)
  if (context.output !== null) parts.push(`Last lines of its output:\n${context.output.join('\n')}`)
  if (context.request !== null) parts.push(`Request: ${context.request}`)
  if (feature === 'suggest') parts.push(`Typed so far: ${context.line}`)
  else if (context.line !== '') parts.push(`Current input line: ${context.line}`)
  return parts.join('\n\n')
}
