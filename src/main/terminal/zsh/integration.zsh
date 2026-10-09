# worfy: shell integration of a Terminal's zsh. Prints the OSC 633 sequences of VS Code's shell
# integration (https://code.visualstudio.com/docs/terminal/shell-integration), which main reads out
# of the output (src/main/terminal/osc.ts):
#
#   A, B        the prompt starts and ends: invisible insertions %{…%} at the ends of PS1
#   E;<line>    the command line about to run, escaped: \ to \\, ; and codes 0x20 and below to \xHH
#   C           the command starts
#   D;<code>    the command finished, with its exit code
#   P;Cwd=<dir> the current folder, escaped as E
#
# Unlike VS Code, every sequence ends with the nonce of this shell (;<nonce>): a program run in the
# Terminal does not know it, so it cannot forge one. A command line that starts with a space gets C
# and D but no E: its text does not reach worfy (zsh's HIST_IGNORE_SPACE convention).

builtin autoload -Uz add-zsh-hook

__worfy_executed=0
__worfy_prompt_start=$'%{\e]633;A;'"$__worfy_nonce"$'\a%}'
__worfy_prompt_end=$'%{\e]633;B;'"$__worfy_nonce"$'\a%}'

# Prints one sequence: 633;<body>;<nonce>.
__worfy_osc() {
  builtin printf '\e]633;%s;%s\a' "$1" "$__worfy_nonce"
}

# Escapes $1 into __worfy_escaped: \ to \\, ; and codes 0x20 and below to \xHH. Bytes, not
# characters: the bytes of a non-ASCII character pass as they are.
__worfy_escape() {
  builtin emulate -L zsh -o extended_glob
  builtin local LC_ALL=C out=${1//\\/\\\\} char
  out=${out//;/\\x3b}
  out=${out// /\\x20}
  while [[ $out == (#b)*([[:cntrl:]])* ]]; do
    char=$match[1]
    out=${out//$char/\\x${(l:2::0:)$(( [##16] #char ))}}
  done
  typeset -g __worfy_escaped=$out
}

# Puts A at the start of PS1 and B at its end, unless they are there: worfy's preexec takes them
# out, and a prompt framework may build PS1 anew on every prompt.
__worfy_wrap_prompt() {
  builtin emulate -L zsh
  [[ $PS1 == *"$__worfy_prompt_start"* ]] || PS1=$__worfy_prompt_start$PS1
  [[ $PS1 == *"$__worfy_prompt_end"* ]] || PS1=$PS1$__worfy_prompt_end
}

# Keeps worfy's precmd the last of precmd_functions: the hooks of prompt frameworks that build PS1
# run before it, so A and B land in the PS1 they built.
__worfy_precmd_last() {
  builtin emulate -L zsh
  [[ ${precmd_functions[-1]} == __worfy_precmd ]] && builtin return 0
  precmd_functions=(${precmd_functions:#__worfy_precmd} __worfy_precmd)
}

__worfy_precmd() {
  builtin local code=$?
  builtin emulate -L zsh
  # D only after a command ran: an empty line or Ctrl+C at the prompt ran none.
  if (( __worfy_executed )); then
    __worfy_osc "D;$code"
    __worfy_executed=0
  fi
  __worfy_escape "$PWD"
  __worfy_osc "P;Cwd=$__worfy_escaped"
  __worfy_wrap_prompt
  __worfy_precmd_last
}

__worfy_preexec() {
  builtin emulate -L zsh
  PS1=${PS1//"$__worfy_prompt_start"/}
  PS1=${PS1//"$__worfy_prompt_end"/}
  __worfy_executed=1
  if [[ $1 != ' '* ]]; then
    __worfy_escape "$1"
    __worfy_osc "E;$__worfy_escaped"
  fi
  __worfy_osc C
}

add-zsh-hook precmd __worfy_precmd
add-zsh-hook preexec __worfy_preexec
