// The Suggestion of Terminal AI from the model: the handler of `ask <id> suggest <line>`.
//
// The shell asks when the history of commands had nothing for the line and the user stopped typing
// (src/main/terminal/zsh/rc.d/20-suggest-ai.zsh). The handler asks the assist service — Haiku
// without thinking, one request, 5 s at most — with what the shell integration knows of the
// Terminal (input.ts), and answers `show` with the rest of the line.
//
// The model is asked for the whole command line, not for its tail: asked for the tail it lost the
// space before a new word in most answers, and `npm run` + `dev` is a broken command. Grey is the
// answer without what was typed; an answer that does not start with what was typed is not shown.
//
// Every refusal is silent: the feature off in Settings, the Limits above their threshold, a
// command running, a full-screen program, a line that starts with a space, a process that did not
// start, a timeout, an empty answer. Nothing is printed into the Terminal and the Suggestion from
// history goes on in the shell. Nothing here writes a log line: the line, the history and the
// answer stay out of the log.
import { terminalAiInput } from '../input'
import type { ShellFeature } from '../shell-link'

/**
 * What is shown in grey after `typed` for the model's `answer`: the answer without what was typed.
 * Null when the answer does not start with it or adds nothing to it.
 */
export function suggestionRest(typed: string, answer: string): string | null {
  return answer.length > typed.length && answer.startsWith(typed) ? answer.slice(typed.length) : null
}

const suggest: ShellFeature = {
  feature: 'suggest',
  async ask(ask, reply, context) {
    // The widget asks about neither. An answer is one line, so it never continues several.
    if (ask.line === '' || ask.line.includes('\n')) return
    const state = context.shellState(ask.terminal)
    const input = state === null ? null : terminalAiInput(state, ask.line)
    if (input === null) return
    const assist = await context.assist()
    const answer = await assist.request('suggest', input, ask.signal)
    if (!answer.ok) return
    const rest = suggestionRest(ask.line, answer.command)
    if (rest !== null) reply.show(rest)
  },
}

export default suggest
