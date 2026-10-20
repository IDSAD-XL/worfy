// Next command of Terminal AI: the handler of `ask <id> next ''`.
//
// The shell asks on the first prompt after a command it ran, while the line is empty
// (src/main/terminal/zsh/rc.d/30-next-command.zsh): it knows when a command was run and whether it
// started with a space, main does not. The pause is kept here: the handler waits NEXT_COMMAND_PAUSE_MS
// on the ask's signal, and the first key the user presses cancels the ask (rc.d/10-assist.zsh sends
// `cancel` on every change of the line), so a user who types asks nothing. Then the assist service
// is asked — Sonnet with `effort: 'low'`, or Haiku by Settings, one request, 8 s at most — with what
// the shell integration knows of the Terminal (input.ts): the last command and its exit code, the
// folder, the last commands; the branch is found by the service. No output of a command.
//
// The answer is a whole command line, shown in grey on the empty line. Nothing runs: → puts it
// into the line, Enter stays the user's.
//
// Every refusal is silent: the feature off in Settings, the Limits, a command running, a full-screen
// program, a process that did not start, a timeout, an empty answer. Nothing is printed into the
// Terminal, and nothing here writes a log line: the commands and the answer stay out of the log.
import { terminalAiInput } from '../input'
import type { ShellFeature } from '../shell-link'

/** How long the empty line stands before the model is asked (spec, "Decided without the owner", point 2). */
export const NEXT_COMMAND_PAUSE_MS = 800

/** True once `ms` passed; false as soon as `signal` is aborted. */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const aborted = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve(true)
    }, ms)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

export interface NextCommandOptions {
  /** NEXT_COMMAND_PAUSE_MS by default; the tests give a shorter one. */
  pauseMs?: number
}

export function nextCommandFeature(options: NextCommandOptions = {}): ShellFeature {
  const pauseMs = options.pauseMs ?? NEXT_COMMAND_PAUSE_MS
  return {
    feature: 'next',
    async ask(ask, reply, context) {
      // The shell asks only on an empty line: anything typed is the user's own command.
      if (ask.line !== '') return
      if (!(await pause(pauseMs, ask.signal))) return
      const state = context.shellState(ask.terminal)
      const input = state === null ? null : terminalAiInput(state, '')
      if (input === null) return
      const assist = await context.assist()
      const answer = await assist.request('next', input, ask.signal)
      if (answer.ok && answer.command !== '') reply.show(answer.command)
    },
  }
}

export default nextCommandFeature()
