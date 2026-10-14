// What a Terminal's shell knows, as the input of a Terminal AI request: the one place where the
// state of the shell integration (ShellState, src/main/terminal/osc.ts) becomes a TerminalAiInput
// (src/shared/terminal-ai/context.ts). Every feature that asks the assist service for a Terminal
// builds its input here, so all of them send the same things.
//
// It carries the line, the folder, the last commands, the exit code of the last one, and the signs
// "a command runs" and "alternate screen", on which the service refuses the request. No git branch:
// the service finds it itself (git-branch.ts). Nothing of the environment, and no output of a
// command unless the caller gives it (only Fix does). Trimming and redaction come later, in
// prepareContext().
import type { ShellState } from '../terminal/osc'
import type { TerminalAiInput } from '../../shared/terminal-ai/context'

/** What a feature adds to the state of the shell: the words of a Command request, the output tail of Fix. */
export type TerminalAiInputExtra = Partial<Pick<TerminalAiInput, 'request' | 'output'>>

/**
 * The input of a request about `line` in the shell of `state`. Null when the shell has not told its
 * folder: then the integration has not spoken yet, and nothing is asked.
 */
export function terminalAiInput(state: ShellState, line: string, extra: TerminalAiInputExtra = {}): TerminalAiInput | null {
  if (state.cwd === null) return null
  return {
    line,
    cwd: state.cwd,
    commands: [...state.commands],
    exitCode: state.exitCode,
    commandRunning: state.commandRunning,
    alternateScreen: state.altScreen,
    ...(extra.request === undefined ? {} : { request: extra.request }),
    ...(extra.output === undefined ? {} : { output: [...extra.output] }),
  }
}
