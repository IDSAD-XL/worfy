# worfy: the Suggestion of Terminal AI from the model, for a line the history of commands has
# nothing for.
#
# rc.d/10-assist.zsh draws the grey text, keeps the link to worfy's main process and looks into the
# history on every change of the line. This script adds one thing: when the history gave nothing
# and the line then stayed as it is for __worfy_suggest_pause_ms, it sends
# `ask <id> suggest <line>`. Main asks the model and answers `show <id> <the rest of the line>`,
# which 10-assist.zsh draws in grey if the line is still the one that was asked about: every change
# of the line cancels the open ask there. While the answer is awaited nothing is shown. A refusal of
# main (the Limits, the settings, no process) is silence.
#
# No ask goes out for:
#   - an empty line, and a line that starts with a space (it never leaves the shell);
#   - a line that starts with `# `: those are the words of a Command request, not a command;
#   - a line the user did not type: one worfy put there (`insert`), or one taken from a Suggestion
#     with → or Alt+→. While such a line stands as it was given it is in __worfy_suggest_given; a
#     script that puts a line itself sets that variable to the line before _worfy_assist_changed;
#   - a line the history answered, and a line that goes on the Suggestion shown before.
#
# The pause is one timer at a time: a subshell that waits (zselect, no program is run) on a pipe zle
# watches. A key during the pause moves the moment to ask and leaves the timer alone; when the timer
# ends too soon for the line as it is by then, the next one waits for what is left. Enter, and a
# line there is nothing to ask about, end the timer and its subshell at once.

# Only where rc.d/10-assist.zsh set its widget up: it does that only where a line is edited. zselect
# waits, EPOCHREALTIME is the clock, sysparams tells the timer's subshell its pid, funcstack tells
# who changed the line.
(( ${+functions[_worfy_assist_ask]} )) || builtin return 0
builtin zmodload zsh/zselect zsh/datetime zsh/system zsh/parameter 2>/dev/null || builtin return 0

# How long the line stays unchanged before the model is asked, in milliseconds (spec, "Решено без
# владельца", point 2). A script read before this one may set another: the tests do.
[[ ${__worfy_suggest_pause_ms-} == <1-> ]] || builtin typeset -g __worfy_suggest_pause_ms=600

builtin typeset -g __worfy_suggest_fd=''      # the pipe of the timer that runs; empty without one
builtin typeset -g __worfy_suggest_pid=''     # the subshell of that timer
builtin typeset -gF __worfy_suggest_due=0     # when to ask, in seconds of EPOCHREALTIME; 0: nothing to ask
builtin typeset -g __worfy_suggest_given=''   # the line as it was given, not typed, while it stands

# True for a line the model may be asked about: for any other no timer is started.
_worfy_suggest_wanted() {
  builtin emulate -L zsh
  [[ -n $BUFFER && $BUFFER != ' '* && $BUFFER != '# '* && $BUFFER != "$__worfy_suggest_given" ]] && _worfy_assist_enabled suggest
}

# Ends the timer and its subshell; nothing is asked after it.
_worfy_suggest_stop() {
  builtin emulate -L zsh
  builtin local fd=$__worfy_suggest_fd pid=$__worfy_suggest_pid
  __worfy_suggest_due=0
  [[ -n $fd ]] || builtin return 0
  __worfy_suggest_fd='' __worfy_suggest_pid=''
  builtin zle -F $fd 2>/dev/null
  { builtin exec {fd}<&- } 2>/dev/null
  [[ $pid == <2-> ]] && builtin kill -TERM $pid 2>/dev/null
  builtin return 0
}
builtin zle -N _worfy_suggest_stop

# Starts the timer for what is left until __worfy_suggest_due, unless one runs already. Its subshell
# writes its pid, so it can be ended, and then only waits: the pipe closes when it is over.
_worfy_suggest_timer() {
  builtin emulate -L zsh
  [[ -z $__worfy_suggest_fd ]] || builtin return 0
  builtin local fd pid
  # zselect counts in hundredths of a second; one more, so the timer does not end before the moment.
  builtin local -i wait=$(( (__worfy_suggest_due - EPOCHREALTIME) * 100 + 1 ))
  { builtin exec {fd}< <(builtin print -r -- $sysparams[pid]; builtin zselect -t $wait) } 2>/dev/null || builtin return 0
  builtin read -r -u $fd pid 2>/dev/null
  __worfy_suggest_fd=$fd __worfy_suggest_pid=$pid
  builtin zle -F -w $fd _worfy_suggest_timer_end
}

# The handler of the timer's pipe (zle -F -w): the timer is over, and the line is still one to ask
# about (any other ended the timer itself). The line changed meanwhile, or the subshell was ended
# by something else: the next timer waits for what is left. Otherwise the pause is over, and main
# is asked about the line.
_worfy_suggest_timer_end() {
  builtin emulate -L zsh
  builtin local fd=$1 REPLY
  builtin zle -F $fd 2>/dev/null
  { builtin exec {fd}<&- } 2>/dev/null
  __worfy_suggest_fd='' __worfy_suggest_pid=''
  if (( EPOCHREALTIME < __worfy_suggest_due )); then
    _worfy_suggest_timer
    builtin return 0
  fi
  __worfy_suggest_due=0
  _worfy_assist_ask suggest "$BUFFER"
  builtin return 0
}
builtin zle -N _worfy_suggest_timer_end

# The line changed (__worfy_assist_line_hooks): $1 is `history` or `kept` when there is grey text for
# it already. Otherwise the pause starts over.
_worfy_suggest_line() {
  builtin emulate -L zsh
  # Given, not typed: main's `insert` and the keys that take a Suggestion change the line from these.
  if (( ${funcstack[(I)_worfy_assist_(on_insert|take|take_word)]} )); then
    __worfy_suggest_given=$BUFFER
  elif [[ $BUFFER != "$__worfy_suggest_given" ]]; then
    __worfy_suggest_given=''
  fi
  if [[ -z $1 ]] && _worfy_suggest_wanted; then
    __worfy_suggest_due=$(( EPOCHREALTIME + __worfy_suggest_pause_ms / 1000. ))
    _worfy_suggest_timer
  else
    _worfy_suggest_stop
  fi
  builtin return 0
}

__worfy_assist_line_hooks+=(_worfy_suggest_line)
# Enter (or Ctrl+C): the line is no longer edited, and what runs next gets nothing of the timer's.
add-zle-hook-widget line-finish _worfy_suggest_stop
