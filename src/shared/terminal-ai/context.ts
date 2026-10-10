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
/** A line of the Fix output tail longer than this is cut. */
export const MAX_OUTPUT_LINE_CHARS = 500

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

/**
 * The first `limit` characters of `text`, without a word the cut splits: when the cut falls inside a
 * run of non-space characters, that run goes too. A secret cut in two would no longer match its
 * pattern, and its head would reach the model; so the cut never leaves the head of anything.
 */
function headOf(text: string, limit: number): string {
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  return /\S/.test(text.charAt(limit)) ? head.replace(/\S+$/, '') : head
}

/**
 * `text` redacted, then cut to `max`. What goes into redaction is cut first at four times `max`, only
 * to bound its work, and that cut drops the word it splits (headOf): redaction shrinks what comes
 * before (a long JWT becomes `[redacted]`), so text from near the first cut may land within `max`, and
 * a secret's head left there would go out. The second cut acts on redacted text: every secret this
 * module recognises is already whole `[redacted]` by then.
 */
function redactThenCut(text: string, max: number): string {
  const redacted = redactSecrets(headOf(text, 4 * max))
  return redacted.length > max ? redacted.slice(0, max) : redacted
}

const field = (text: string): string => redactThenCut(text, MAX_FIELD_CHARS)

/** The Fix output tail: the last lines, redacted as one text (a key block spans lines), each line cut as a field is. */
function outputTail(lines: readonly string[]): string[] {
  const tail = lines.slice(-MAX_OUTPUT_LINES).map((line) => headOf(line, 4 * MAX_OUTPUT_LINE_CHARS))
  return redactSecrets(tail.join('\n'))
    .split('\n')
    .map((line) => (line.length > MAX_OUTPUT_LINE_CHARS ? line.slice(0, MAX_OUTPUT_LINE_CHARS) : line))
}

/** The context of `feature` out of what the shell knows; `branch` is the one main found. */
export function prepareContext(feature: TerminalAiFeature, input: TerminalAiInput, branch: string | null = input.branch ?? null): TerminalAiContext {
  const commands = input.commands.filter((command) => command.trim() !== '' && !isPrivateLine(command)).slice(-MAX_COMMANDS)
  const output = feature === 'fix' && input.output !== undefined ? outputTail(input.output) : null
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
