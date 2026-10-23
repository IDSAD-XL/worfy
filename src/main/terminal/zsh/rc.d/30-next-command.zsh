# worfy: Next command of Terminal AI. Once a command is over and zsh shows the line empty, the
# model proposes the command to run next, in grey.
#
# rc.d/10-assist.zsh draws the grey text, keeps the link to worfy's main process and calls the line
# hooks on a new prompt too (from line-init). This script adds one thing: on the first prompt after
# a command the shell ran, while the line is empty, it sends `ask <id> next ''`. Main waits its pause
# (800 ms, src/main/terminal-ai/features/next-command.ts), asks the model and answers
# `show <id> <command>`, which 10-assist.zsh draws in grey while the ask is open. The first change
# of the line cancels the ask there; typing the start of the answer keeps the rest of it grey (the
# `kept` of 10-assist.zsh), anything else hides it. → takes it, Esc hides it. Enter on the empty line
# runs nothing: the grey text is not part of the line.
#
# One ask per prompt, and none:
#   - on the first prompt of the shell, after an empty line, after Ctrl+C: no command ran;
#   - after a command that starts with a space: it stays out of the history and out of the model;
#   - on a line that is not empty as the prompt comes (a line zsh was given back);
#   - when the line is emptied again: that is not a new prompt.
# Without the link, or with Next command off in the settings, _worfy_assist_ask fails and nothing
# happens; nothing is ever printed into the Terminal.

# Only where rc.d/10-assist.zsh set its widget up: it does that only where a line is edited.
(( ${+functions[_worfy_assist_ask]} )) || builtin return 0

# The shell integration has add-zsh-hook loaded already; autoload +X fails on a function that is.
(( ${+functions[add-zsh-hook]} )) || builtin autoload -Uz +X add-zsh-hook 2>/dev/null || builtin return 0

builtin typeset -gi __worfy_next_ran=0   # 1 from a command the shell ran to the prompt after it

# preexec: $1 is the line as it was typed.
_worfy_next_preexec() {
  builtin emulate -L zsh
  [[ $1 == [[:blank:]]* ]] && __worfy_next_ran=0 || __worfy_next_ran=1
}

# The line changed (__worfy_assist_line_hooks). The first call after a command is the one of the new
# prompt (10-assist.zsh calls the hooks from line-init); it takes the mark of the command, so any
# later change of the line on this prompt finds none and asks nothing.
_worfy_next_line() {
  builtin emulate -L zsh
  # Before the shell has read the settings (the first command can be typed before the config of the
  # first prompt is read, and a wrapped widget gives that link up) the mark stays: the config, once
  # read, calls the line hooks again.
  (( __worfy_assist_configured )) || builtin return 0
  builtin local -i ran=$__worfy_next_ran
  __worfy_next_ran=0
  (( ran )) && [[ -z $BUFFER ]] || builtin return 0
  builtin local REPLY
  _worfy_assist_ask next ''
  builtin return 0
}

__worfy_assist_line_hooks+=(_worfy_next_line)
add-zsh-hook preexec _worfy_next_preexec
