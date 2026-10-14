# worfy: Command request of Terminal AI. A line that starts with `# ` (a hash and a space) and
# Enter: the line is not run, worfy is asked for a command, and the command of the answer replaces
# the line, the cursor at its end. Enter stays the user's: nothing runs by itself.
#
# rc.d/10-assist.zsh keeps the link to worfy's main process and draws the grey text. This script
# wraps accept-line. For `# <words>`, with Command request on in the settings, it sends
# `ask <id> request <line>` and shows the grey note "asking Claude…" instead of accepting the line,
# so the line goes neither to zsh nor to the history. Main asks the model and answers:
#   - `status <id>` with an empty text and right after it `insert <command>`: the answer;
#   - `status <id> <reason>`: a refusal ("Limits reached until 14:20"), shown in grey.
# Any key before the answer cancels the ask (`cancel <id>`) and the line stays as it is. Without
# `# ` in front, with Command request off or without the link, Enter is accept-line as before.
#
# `insert` carries no id. An answer main sent before the `cancel` of the user's key reached it would
# still replace the line the user went on with; so an insert that follows the empty status of a
# request of this script that is no longer open is dropped. An insert without such a status (the
# ⌘I panel of the Terminal Node) is taken as before.

# Only where rc.d/10-assist.zsh set its widget up: it does that only where a line is edited.
(( ${+functions[_worfy_assist_ask]} && ${+functions[_worfy_assist_on_insert]} && ${+functions[_worfy_assist_on_status]} )) || builtin return 0
builtin zmodload zsh/parameter zsh/zleparameter 2>/dev/null || builtin return 0

builtin typeset -gi __worfy_request_id=0     # the id of the ask of the last `# …` line; 0: none
builtin typeset -gi __worfy_request_fresh=0  # 1 between the ask and the redraw that follows it
builtin typeset -gi __worfy_request_drop=0   # 1: the next insert answers a request no longer open
builtin typeset -gA __worfy_request_waiting  # the ids of the requests with no answer yet

# Asks for the line when it is a Command request; fails for any other line, and when no ask went out.
_worfy_request_ask() {
  builtin emulate -L zsh -o extended_glob
  builtin local REPLY id
  [[ $BUFFER == '# '*[^[:space:]]* && $BUFFER != *[$'\n\r']* ]] || builtin return 1
  # Fails, and sends nothing, with Command request off in the settings.
  _worfy_assist_ask request "$BUFFER" || builtin return 1
  __worfy_request_id=$REPLY __worfy_request_fresh=1
  # Requests the user left are forgotten after a while: their answer has long come or never will.
  for id in ${(k)__worfy_request_waiting}; do
    (( id < REPLY - 32 )) && builtin unset "__worfy_request_waiting[$id]"
  done
  __worfy_request_waiting[$REPLY]=1
  _worfy_assist_status 'asking Claude…'
}

# Enter. The widget behind it runs outside `emulate`, with the user's own options.
_worfy_request_accept() {
  _worfy_request_ask && builtin return 0
  builtin zle _worfy_request_was-accept-line -- "$@"
}

# After every key: a key that comes while the request waits cancels it, whether it changed the line
# or not (rc.d/10-assist.zsh cancels only on a change), and takes the grey note away. zsh redraws
# once right after Enter asked; that redraw is not a key. The handlers of the link run without it.
_worfy_request_pre_redraw() {
  builtin emulate -L zsh
  if (( __worfy_request_fresh )); then
    __worfy_request_fresh=0
    builtin return 0
  fi
  (( __worfy_request_id && __worfy_request_id == __worfy_assist_asked )) || builtin return 0
  _worfy_assist_cancel
  [[ $__worfy_assist_kind == status ]] && _worfy_assist_hide
  builtin return 0
}
builtin zle -N _worfy_request_pre_redraw

# status <id> <text> for a request of this script: an empty text comes right before the insert of
# its answer. The insert is the answer to the line only while the request is still open.
_worfy_request_status() {
  builtin emulate -L zsh
  [[ $1 == <1-> ]] && (( ${+__worfy_request_waiting[$1]} )) || builtin return 0
  builtin unset "__worfy_request_waiting[$1]"
  [[ -z $2 ]] || builtin return 0
  (( $1 == __worfy_assist_asked )) && __worfy_request_drop=0 || __worfy_request_drop=1
  builtin return 0
}

# The handlers of `status` and `insert` of rc.d/10-assist.zsh, wrapped once, however often this
# script is read. The wrapper keeps the name _worfy_assist_on_insert: rc.d/20-suggest-ai.zsh tells
# by it that the line was given, not typed, and asks the model nothing about it.
if (( ! ${+functions[_worfy_request_status_was]} )); then
  functions[_worfy_request_status_was]=$functions[_worfy_assist_on_status]
  _worfy_assist_on_status() {
    _worfy_request_status "$@"
    _worfy_request_status_was "$@"
  }
fi
if (( ! ${+functions[_worfy_request_insert_was]} )); then
  functions[_worfy_request_insert_was]=$functions[_worfy_assist_on_insert]
  _worfy_assist_on_insert() {
    if (( __worfy_request_drop )); then
      __worfy_request_drop=0
      builtin return 0
    fi
    _worfy_request_insert_was "$@"
  }
fi

() {
  builtin emulate -L zsh
  case ${widgets[accept-line]} in
    (user:_worfy_request_accept) builtin return 0 ;;
    (user:*) builtin zle -N _worfy_request_was-accept-line ${widgets[accept-line]#user:} ;;
    (*) builtin zle -A .accept-line _worfy_request_was-accept-line ;;
  esac
  builtin zle -N accept-line _worfy_request_accept
  add-zle-hook-widget line-pre-redraw _worfy_request_pre_redraw
}
