// Fix of Terminal AI: after a command that ended with an exit code other than 0, the "Fix" button
// in the header of its Terminal Node asks Sonnet for the corrected command, and that command lands in
// the line of the shell. It never runs: Enter stays the user's (ADR-0058, point 6).
//
// Fix starts with an IPC channel (src/main/ipc/terminal-ai-fix.ts), not with an `ask` of the shell,
// so it is not a module of ./features/. This file holds what the channel needs of main:
//   - FailedCommands: which Terminal has a failed command to fix, from the events of the shell
//     integration. A command counts when its line is known (one that starts with a space is not) and
//     its exit code is not 0; the next command that starts, the shell leaving and a Fix that put its
//     answer into the line take it away;
//   - runFix(): the command line, its exit code, the folder, the branch and the tail of its output
//     (src/shared/terminal-ai/output-tail.ts) go to `request('fix', …)` of the assist service, and the
//     command of the answer goes to the shell as `insert`. The service redacts the context, the tail
//     included, before anything goes out (prepareContext, src/shared/terminal-ai/context.ts).
//
// The command line reaches the model as the newest of the recent commands, with the exit code of
// the last command; nothing here writes a log line: the command, its output and the answer stay out
// of the log.
import type { ShellEvent, ShellState } from '../terminal/osc'
import { outputTail } from '../../shared/terminal-ai/output-tail'
import type { AssistService } from './assist'
import { NOT_READY, refusalText } from './features/command-request'
import { terminalAiInput } from './input'
import type { MainMessage } from './protocol'

/** A command of a Terminal that failed, as the shell integration told it. */
export interface FailedCommand {
  /** Its line, as the user typed it. */
  command: string
  exitCode: number
}

/** The failed command of every Terminal that has one to fix. */
export class FailedCommands {
  private readonly last = new Map<string, FailedCommand>()

  /** The failed command of `terminal`, while it is the last one and no new one started. */
  get(terminal: string): FailedCommand | undefined {
    return this.last.get(terminal)
  }

  /** Reads one event of the shell of `terminal`; answers true when its failed command changed. */
  event(terminal: string, event: ShellEvent): boolean {
    if (event.type === 'command-finished' && event.command !== null && event.exitCode !== null && event.exitCode !== 0) {
      // A new object for every failure: a Fix in flight tells by it that its command is still the last.
      this.last.set(terminal, { command: event.command, exitCode: event.exitCode })
      return true
    }
    if (event.type === 'prompt') return false
    return this.last.delete(terminal)
  }

  /** `terminal` has nothing to fix any more (its shell left, its Fix is in the line); true when it had. */
  forget(terminal: string): boolean {
    return this.last.delete(terminal)
  }

  /** Forgets `failed` only while it is still the failed command of `terminal`. */
  done(terminal: string, failed: FailedCommand): boolean {
    if (this.last.get(terminal) !== failed) return false
    this.last.delete(terminal)
    return true
  }
}

/** The answer of a Fix to the button: the command is in the line, or why nothing was put there. */
export type FixResult = { ok: true } | { ok: false; message: string }

/** The note of a Terminal with no failed command to fix (the button was stale). */
export const NOTHING_TO_FIX = 'Nothing to fix'
/** The note of a Fix whose command is no longer the last one, or that was cancelled. */
export const FIX_CANCELLED = 'Cancelled'
export const BUSY = 'Terminal is busy'

/** What runFix() needs of main. */
export interface FixContext {
  shellState(terminal: string): ShellState | null
  assist(): Promise<Pick<AssistService, 'request'>>
  /** Sends a message to the zsh of `terminal`; false when it is not connected. */
  push(terminal: string, message: MainMessage): boolean
  /** The failed commands, from the events of the shell integration. */
  failed: FailedCommands
}

/**
 * Asks the model for the corrected command of the failed command of `terminal` and puts it into the
 * line of the shell. The shell must wait for input: while a command runs or a full-screen program
 * holds the Terminal the answer is "Terminal is busy", and the model is not asked. An answer that
 * comes after a new command started, or after `signal` aborted, is not put into the line.
 */
export async function runFix(context: FixContext, terminal: string, signal?: AbortSignal): Promise<FixResult> {
  const state = context.shellState(terminal)
  if (state !== null && (state.commandRunning || state.altScreen || !state.awaitingInput)) return { ok: false, message: BUSY }
  const failed = context.failed.get(terminal)
  if (failed === undefined) return { ok: false, message: NOTHING_TO_FIX }
  const input = state === null ? null : terminalAiInput(state, '', { output: outputTail(state.lastOutput) })
  if (input === null) return { ok: false, message: NOT_READY }
  const answer = await (await context.assist()).request('fix', input, signal)
  if (!answer.ok) return { ok: false, message: refusalText(answer) ?? FIX_CANCELLED }
  // A new command started meanwhile, or the caller gave up: the answer is for a line that is gone.
  if (signal?.aborted === true || context.failed.get(terminal) !== failed) return { ok: false, message: FIX_CANCELLED }
  // The command lands in the line; Enter stays the user's.
  if (!context.push(terminal, { type: 'insert', text: answer.command })) return { ok: false, message: 'The shell is gone' }
  context.failed.done(terminal, failed)
  return { ok: true }
}
