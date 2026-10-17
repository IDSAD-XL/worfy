# worfy: Terminal AI in a Terminal's zsh. Two things live here.
#
# The Suggestion from the history of commands: grey text after the cursor, the rest of the last
# command of the history that starts with what is typed. zsh draws it itself, as the plugin
# zsh-autosuggestions does (POSTDISPLAY and region_highlight), so every screen that shows this shell
# sees it. → at the end of the line takes it whole, Alt+→ up to the end of the next word, Esc hides
# it. A line that starts with a space gets none. No process is started and worfy is not asked.
#
# The link to worfy's main process: one connection to its Unix socket (zsh/net/socket), read with
# `zle -F` while zsh waits for a key. One message is one line, its fields separated by TAB; in a
# field \ is \\, a line feed \n, a TAB \t, a carriage return \r (src/main/terminal-ai/protocol.ts).
#
# zsh cannot keep a descriptor it opened from the programs it starts, so the link lives only while
# zsh edits a line: it closes before every command (preexec) and opens again, with a new hello, when
# the next prompt starts the line editor. The token for the hello stays in a shell variable that is
# not exported, so no program the shell starts sees it.
#
#   to worfy:    hello <token> · ask <id> <feature> <line> · cancel <id>
#   from worfy:  show <id> <text> · status <id> <text> · insert <text> · config <features>
#
# A message <kind> from worfy goes to the function _worfy_assist_on_<kind>, with its fields decoded.
# The scripts of the features (rc.d/20-… and later) use these, all from a widget:
#
#   _worfy_assist_ask <feature> <line>   asks worfy; the id of the ask is in REPLY. The ask before it
#                                        is cancelled. Fails without a link, for a feature the
#                                        settings turned off and for a line that starts with a space.
#   _worfy_assist_cancel                 cancels the ask that is open, if any.
#   _worfy_assist_show <text>            shows a Suggestion: grey, taken with → and Alt+→.
#   _worfy_assist_status <text>          shows a grey note instead: not taken by any key.
#   _worfy_assist_hide                   takes the grey text away.
#   _worfy_assist_enabled <feature>      whether the settings have the feature on.
#   __worfy_assist_line_hooks            functions called when the line changed, after the look
#                                        into the history: $1 is `history` when it gave a
#                                        Suggestion, `kept` when the Suggestion shown before still
#                                        fits, empty otherwise.
#
# Without the socket, or once it is closed, the Suggestion from history goes on and the rest is
# silent: nothing is ever printed into the Terminal.

# Only where a line is edited. Elsewhere the token goes from the shell's variables.
if ! [[ -o interactive && -o zle ]] || ! builtin autoload -Uz +X add-zle-hook-widget 2>/dev/null; then
  builtin unset __worfy_assist_socket __worfy_assist_token
  builtin return 0
fi

# Not exported even under the user's `setopt allexport`: zshrc.zsh takes the export off every
# __worfy_ variable once rc.d/ is read, and every function here runs under `emulate -L zsh`.
builtin typeset -g __worfy_assist_fd=''         # the link; empty without one, and while a command runs
builtin typeset -g __worfy_assist_inbox=''      # what came over the link and is not a whole line yet
builtin typeset -gi __worfy_assist_id=0         # the id of the last ask
builtin typeset -gi __worfy_assist_asked=0      # the id of the ask that is open; 0 without one
builtin typeset -g __worfy_assist_line=''       # the line the grey text was made for
builtin typeset -gi __worfy_assist_seen=0       # 1 once __worfy_assist_line is the line of this prompt
builtin typeset -g __worfy_assist_text=''       # the grey text worfy drew: what POSTDISPLAY holds
builtin typeset -g __worfy_assist_kind=''       # suggestion (taken with →) or status
builtin typeset -gi __worfy_assist_memo=1       # 0 once this zsh was seen to drop the memo of a highlight
builtin typeset -gi __worfy_assist_configured=0 # 1 once worfy sent the settings
builtin typeset -gA __worfy_assist_features     # the features the settings have on
builtin typeset -gi __worfy_assist_own=1        # 0: the user has zsh-autosuggestions, worfy suggests nothing
builtin typeset -ga __worfy_assist_line_hooks
builtin typeset -gA __worfy_assist_then         # what a key worfy took did before, by widget

# ---- the grey text ------------------------------------------------------------------------------

# Takes away the grey text worfy drew; what another plugin put after the line stays. zsh moves the
# entries of region_highlight along with the text typed before them, so worfy's entry is found by
# its memo (zsh 5.9), not by the positions it was added with. An older zsh drops the memo: there
# every entry that is plain `fg=8` goes.
_worfy_assist_hide() {
  builtin emulate -L zsh
  [[ -n $__worfy_assist_text ]] || builtin return 0
  [[ $POSTDISPLAY == "$__worfy_assist_text" ]] && POSTDISPLAY=''
  region_highlight=("${(@)region_highlight:#*memo=worfy-assist*}")
  (( __worfy_assist_memo )) || region_highlight=("${(@)region_highlight:#<-> <-> fg=8}")
  __worfy_assist_text='' __worfy_assist_kind=''
}

# Draws $1 in grey after the line, as $2: suggestion or status.
_worfy_assist_paint() {
  builtin emulate -L zsh
  _worfy_assist_hide
  [[ -n $1 ]] || builtin return 0
  POSTDISPLAY=$1
  __worfy_assist_text=$1 __worfy_assist_kind=$2
  region_highlight+=("$#BUFFER $(( $#BUFFER + $#POSTDISPLAY )) fg=8 memo=worfy-assist")
  [[ ${region_highlight[-1]} == *memo=worfy-assist* ]] && __worfy_assist_memo=1 || __worfy_assist_memo=0
}

_worfy_assist_show() {
  _worfy_assist_paint "$1" suggestion
}

_worfy_assist_status() {
  builtin emulate -L zsh
  _worfy_assist_paint "${1:+  $1}" status
}

# True while a Suggestion of worfy's is on the screen and the cursor is at the end of the line.
_worfy_assist_takeable() {
  builtin emulate -L zsh
  [[ $__worfy_assist_kind == suggestion && -n $__worfy_assist_text && $POSTDISPLAY == "$__worfy_assist_text" ]] && (( CURSOR == $#BUFFER ))
}

# ---- the settings -------------------------------------------------------------------------------

# Whether the feature $1 is on. Before worfy sent the settings (and without a link) only the
# Suggestion from history is. With zsh-autosuggestions worfy draws no Suggestion of its own.
_worfy_assist_enabled() {
  builtin emulate -L zsh
  [[ $1 == (history|suggest) ]] && (( ! __worfy_assist_own )) && builtin return 1
  (( __worfy_assist_configured )) || { [[ $1 == history ]]; builtin return }
  (( ${+__worfy_assist_features[$1]} ))
}

# ---- the link -----------------------------------------------------------------------------------

# Closes the link; until it opens again only the Suggestion from history works.
_worfy_assist_disconnect() {
  builtin emulate -L zsh
  builtin local fd=$__worfy_assist_fd
  [[ -n $fd ]] || builtin return 0
  __worfy_assist_fd='' __worfy_assist_inbox='' __worfy_assist_asked=0
  builtin zle -F $fd 2>/dev/null
  { builtin exec {fd}>&- } 2>/dev/null
  # A note of worfy's ("asking Claude…") would wait for an answer that cannot come. Only from a
  # widget: elsewhere the grey text is not there.
  builtin zle && [[ $__worfy_assist_kind == status ]] && _worfy_assist_hide
  builtin return 0
}

# Opens the link and says hello, unless it is open; fails without a socket or a token.
_worfy_assist_connect() {
  builtin emulate -L zsh
  [[ -z $__worfy_assist_fd ]] || builtin return 0
  [[ -n $__worfy_assist_socket && -n $__worfy_assist_token ]] || builtin return 1
  builtin local REPLY low
  builtin zsocket $__worfy_assist_socket 2>/dev/null || builtin return 1
  # zsocket takes the lowest free descriptor (3): programs use those numbers by convention, and a
  # program a widget starts inherits what the shell holds. The connection moves to one zsh picks
  # above 9.
  low=$REPLY
  { builtin exec {__worfy_assist_fd}<&$low } 2>/dev/null || __worfy_assist_fd=''
  { builtin exec {low}<&- } 2>/dev/null
  _worfy_assist_send hello $__worfy_assist_token || builtin return 1
  builtin zle -F -w $__worfy_assist_fd _worfy_assist_receive
}

# preexec: the command, and every program it starts, gets no link. The ask that is open is given up first.
_worfy_assist_preexec() {
  builtin emulate -L zsh
  _worfy_assist_cancel
  _worfy_assist_disconnect
}

# Sends one message: its kind, then its fields, escaped. Fails without a link.
_worfy_assist_send() {
  builtin emulate -L zsh
  [[ -n $__worfy_assist_fd ]] || builtin return 1
  builtin local field message=$1
  builtin shift
  for field in "$@"; do
    field=${field//\\/\\\\}
    field=${field//$'\n'/\\n}
    field=${field//$'\t'/\\t}
    field=${field//$'\r'/\\r}
    message+=$'\t'$field
  done
  if ! builtin print -r -u $__worfy_assist_fd -- "$message" 2>/dev/null; then
    _worfy_assist_disconnect
    builtin return 1
  fi
}

_worfy_assist_cancel() {
  builtin emulate -L zsh
  (( __worfy_assist_asked )) || builtin return 0
  builtin local id=$__worfy_assist_asked
  __worfy_assist_asked=0
  _worfy_assist_send cancel $id
  builtin return 0
}

_worfy_assist_ask() {
  builtin emulate -L zsh
  # A line that starts with a space never leaves the shell (zsh's HIST_IGNORE_SPACE convention).
  [[ $2 != ' '* ]] || builtin return 1
  _worfy_assist_enabled "$1" || builtin return 1
  _worfy_assist_cancel
  __worfy_assist_id+=1
  _worfy_assist_send ask $__worfy_assist_id "$1" "$2" || builtin return 1
  __worfy_assist_asked=$__worfy_assist_id
  REPLY=$__worfy_assist_id
}

# The handler of the link (zle -F -w): reads what came, without waiting for more, and gives every
# whole line to the function of its kind. $2 is set when the socket was closed or broke.
_worfy_assist_receive() {
  builtin emulate -L zsh -o extended_glob
  builtin local fd=$1 chunk line kind
  builtin local -i code=0
  builtin local -a fields
  if [[ -z $__worfy_assist_fd || $fd != "$__worfy_assist_fd" ]]; then
    builtin zle -F $fd 2>/dev/null
    builtin return 0
  fi
  while (( code == 0 )); do
    builtin sysread -i $fd -t 0 chunk 2>/dev/null
    code=$?
    (( code == 0 )) && __worfy_assist_inbox+=$chunk
    # A line this long is not a message of worfy's.
    (( $#__worfy_assist_inbox > 262144 )) && code=2
  done
  while [[ -n $__worfy_assist_fd && $__worfy_assist_inbox == *$'\n'* ]]; do
    line=${__worfy_assist_inbox%%$'\n'*}
    __worfy_assist_inbox=${__worfy_assist_inbox#*$'\n'}
    fields=("${(@ps:\t:)line}")
    kind=${fields[1]}
    [[ $kind == [a-z][a-z0-9_]# ]] && (( ${+functions[_worfy_assist_on_$kind]} )) || builtin continue
    fields=("${(@g::)fields[2,-1]}")
    _worfy_assist_on_$kind "${fields[@]}"
  done
  # 4: nothing more to read for now. Anything else, or a closed socket: the link is over.
  (( code == 4 )) && [[ -z $2 ]] || _worfy_assist_disconnect
  builtin zle -R
}
builtin zle -N _worfy_assist_receive

# show <id> <text>: the Suggestion for the ask that is still open; an answer to an older ask is late.
_worfy_assist_on_show() {
  builtin emulate -L zsh
  [[ $1 == <1-> ]] && (( $1 == __worfy_assist_asked )) || builtin return 0
  _worfy_assist_show "$2"
}

# status <id> <text>: a grey note; id 0 is not about an ask and is shown whatever is open.
_worfy_assist_on_status() {
  builtin emulate -L zsh
  [[ $1 == <-> ]] && (( $1 == 0 || $1 == __worfy_assist_asked )) || builtin return 0
  _worfy_assist_status "$2"
}

# insert <text>: the line becomes the text, the cursor goes to its end. Nothing runs: Enter is the user's.
_worfy_assist_on_insert() {
  builtin emulate -L zsh
  BUFFER=$1
  CURSOR=$#BUFFER
  _worfy_assist_changed
}

# config <features>: the features the settings have on, separated by spaces. worfy sends it after
# every hello, so after every command as well.
_worfy_assist_on_config() {
  builtin emulate -L zsh -o extended_glob
  builtin local name before="${(okj: :)__worfy_assist_features}"
  builtin local -i configured=$__worfy_assist_configured
  __worfy_assist_features=()
  for name in ${=1}; do
    [[ $name == [a-z][a-z0-9-]# ]] && __worfy_assist_features[$name]=1
  done
  __worfy_assist_configured=1
  # The same settings again: the ask that is open (Next command's, at a new prompt) stays open.
  (( configured )) && [[ ${(okj: :)__worfy_assist_features} == "$before" ]] && builtin return 0
  # A Suggestion that was just turned off goes away now, one that was turned on shows.
  _worfy_assist_changed
}

# ---- the line -----------------------------------------------------------------------------------

# The rest of the last command of the history that starts with the line, in REPLY; fails without one.
_worfy_assist_history_text() {
  builtin emulate -L zsh -o extended_glob
  REPLY=''
  _worfy_assist_enabled history || builtin return 1
  [[ -n $BUFFER && $BUFFER != ' '* ]] || builtin return 1
  builtin local found=${history[(r)${(b)BUFFER}*]}
  REPLY=${found[$#BUFFER+1,-1]}
  [[ -n $REPLY ]]
}

# The line is new: the open ask is about another line, and so is the grey text, unless the user
# typed (or took) its start — then the rest of it stays. The history is asked first.
_worfy_assist_changed() {
  builtin emulate -L zsh
  builtin local before=$__worfy_assist_line shown=$__worfy_assist_text kind=$__worfy_assist_kind hook found='' REPLY
  builtin local -i seen=$__worfy_assist_seen
  __worfy_assist_line=$BUFFER __worfy_assist_seen=1
  _worfy_assist_cancel
  _worfy_assist_hide
  if _worfy_assist_history_text; then
    _worfy_assist_show "$REPLY"
    found=history
  elif (( seen )) && [[ $kind == suggestion && $BUFFER == "$before"?* && "$before$shown" == "$BUFFER"?* ]]; then
    shown=$before$shown
    _worfy_assist_show "${shown[$#BUFFER+1,-1]}"
    found=kept
  fi
  for hook in $__worfy_assist_line_hooks; do
    (( ${+functions[$hook]} )) && $hook "$found"
  done
  builtin return 0
}

# Before zsh draws the line: has it changed since the grey text was made?
_worfy_assist_pre_redraw() {
  builtin emulate -L zsh
  (( __worfy_assist_seen )) && [[ $BUFFER == "$__worfy_assist_line" ]] && builtin return 0
  _worfy_assist_changed
}
builtin zle -N _worfy_assist_pre_redraw

# A new prompt: nothing of the line before it holds. The link opens again, unless the line editor
# runs inside a command (vared, select). The line hooks hear of the new, empty line here, before the
# first key.
_worfy_assist_line_init() {
  builtin emulate -L zsh
  [[ $CONTEXT == (start|cont) ]] && _worfy_assist_connect
  _worfy_assist_cancel
  _worfy_assist_hide
  __worfy_assist_line='' __worfy_assist_seen=0
  _worfy_assist_changed
}
builtin zle -N _worfy_assist_line_init

# Enter (or Ctrl+C): the grey text is not part of the line that stays on the screen.
_worfy_assist_line_finish() {
  builtin emulate -L zsh
  _worfy_assist_cancel
  _worfy_assist_hide
}
builtin zle -N _worfy_assist_line_finish

# ---- the keys -----------------------------------------------------------------------------------

# Takes the whole Suggestion into the line; fails when there is none to take.
_worfy_assist_take() {
  builtin emulate -L zsh
  _worfy_assist_takeable || builtin return 1
  BUFFER+=$__worfy_assist_text
  CURSOR=$#BUFFER
  _worfy_assist_changed
}

# Takes the Suggestion up to the end of its next word, as zsh's emacs-forward-word counts words
# (WORDCHARS); the rest stays grey.
_worfy_assist_take_word() {
  builtin emulate -L zsh
  _worfy_assist_takeable || builtin return 1
  builtin local -i typed=$#BUFFER
  BUFFER+=$__worfy_assist_text
  CURSOR=$typed
  builtin zle .emacs-forward-word
  (( CURSOR > typed )) || CURSOR=$#BUFFER
  BUFFER=${BUFFER[1,CURSOR]}
  CURSOR=$#BUFFER
  _worfy_assist_changed
}

# →, and whatever else the user has on forward-char: at the end of the line it takes the
# Suggestion, anywhere else it does what it did. The widget behind it runs outside `emulate`, with
# the user's own options.
_worfy_assist_right() {
  _worfy_assist_take && builtin return 0
  builtin zle _worfy_assist_was-forward-char -- "$@"
}
_worfy_assist_vi_right() {
  _worfy_assist_take && builtin return 0
  builtin zle _worfy_assist_was-vi-forward-char -- "$@"
}

# Alt+→ as xterm.js sends it. Without a Suggestion to take it does what the key did before; when
# the key did nothing, it moves a word forward.
_worfy_assist_word() {
  _worfy_assist_take_word && builtin return 0
  builtin zle ${__worfy_assist_then[$WIDGET]:-forward-word} -- "$@"
}

# Esc hides the grey text and forgets the open ask, then does what it did before (vi-cmd-mode in
# the vi keymap). zsh waits KEYTIMEOUT for the rest of a longer sequence first.
_worfy_assist_escape() {
  _worfy_assist_cancel
  _worfy_assist_hide
  [[ -n ${__worfy_assist_then[$WIDGET]} ]] || builtin return 0
  builtin zle ${__worfy_assist_then[$WIDGET]} -- "$@"
}

# ---- setting up ---------------------------------------------------------------------------------

() {
  builtin emulate -L zsh
  builtin local widget keymap was key name
  builtin zmodload zsh/parameter zsh/zleparameter 2>/dev/null

  # zsh-autosuggestions draws its own Suggestion from history: worfy's stays off, the rest works.
  (( ${+functions[_zsh_autosuggest_start]} )) && __worfy_assist_own=0

  for widget name in forward-char _worfy_assist_right vi-forward-char _worfy_assist_vi_right; do
    case ${widgets[$widget]} in
      (user:$name) builtin continue ;;
      (user:*) builtin zle -N _worfy_assist_was-$widget ${widgets[$widget]#user:} ;;
      (*) builtin zle -A .$widget _worfy_assist_was-$widget ;;
    esac
    builtin zle -N $widget $name
  done

  # A widget per keymap, so each remembers what its key did there before.
  for keymap in emacs viins; do
    for key name in '^[[1;3C' _worfy_assist_word '^[' _worfy_assist_escape; do
      was=${"$(builtin bindkey -M $keymap $key 2>/dev/null)"##* }
      [[ $was == $name-* ]] && builtin continue
      # Nothing to go on to: the key did nothing, or the user bound it to a string (bindkey -s).
      [[ $was == undefined-key ]] || (( ! ${+widgets[$was]} )) && was=''
      __worfy_assist_then[$name-$keymap]=$was
      builtin zle -N $name-$keymap $name
      builtin bindkey -M $keymap $key $name-$keymap
    done
  done

  add-zle-hook-widget line-init _worfy_assist_line_init
  add-zle-hook-widget line-pre-redraw _worfy_assist_pre_redraw
  add-zle-hook-widget line-finish _worfy_assist_line_finish

  # The link: the socket and this shell's token came in the environment (zshenv.zsh took them out
  # into variables that are not exported). It opens at the first prompt, not here: the user's
  # .zlogin runs after this file, and what it starts would inherit it.
  if [[ -n $__worfy_assist_socket && -n $__worfy_assist_token ]] && builtin zmodload zsh/net/socket zsh/system 2>/dev/null; then
    builtin typeset -g +x __worfy_assist_socket __worfy_assist_token
    # First of the preexec hooks: the ones before it would start their programs with the link.
    preexec_functions=(_worfy_assist_preexec ${preexec_functions:#_worfy_assist_preexec})
  else
    builtin unset __worfy_assist_socket __worfy_assist_token
  fi
}
