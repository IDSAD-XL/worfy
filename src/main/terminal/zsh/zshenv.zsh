# worfy: the .zshenv of a Terminal's zsh. ZDOTDIR points at worfy's folder (shell-integration.ts),
# so zsh reads worfy's .zshenv, .zprofile, .zshrc and .zlogin; each reads the user's file of the
# same name from the user's own ZDOTDIR (or HOME). While a user file runs, ZDOTDIR is exactly what
# it would be without worfy: the user's value, exported or not, or unset. A user file may change
# ZDOTDIR itself (`: ${ZDOTDIR:=$HOME/.config/zsh}`): the next files of the user are then read from
# there. The user's files are only read, never changed.
#
# This first file takes worfy's variables out of the environment into shell variables that are not
# exported: programs started from the shell do not see the nonce.
__worfy_dir=$ZDOTDIR
__worfy_nonce=$WORFY_SHELL_NONCE
# WORFY_USER_ZDOTDIR is there only when the user's environment had a ZDOTDIR.
if (( ${+WORFY_USER_ZDOTDIR} )); then
  __worfy_user_zdotdir_set=1
  __worfy_user_zdotdir_export=1
  __worfy_user_zdotdir=$WORFY_USER_ZDOTDIR
else
  __worfy_user_zdotdir_set=0
  __worfy_user_zdotdir_export=0
  __worfy_user_zdotdir=$HOME
fi
builtin unset WORFY_USER_ZDOTDIR WORFY_SHELL_NONCE

# Gives the shell the user's ZDOTDIR as it stands: their value, exported or not, or none.
__worfy_zdotdir_user() {
  builtin emulate -L zsh
  if (( ! __worfy_user_zdotdir_set )); then
    builtin unset ZDOTDIR
  elif (( __worfy_user_zdotdir_export )); then
    builtin export ZDOTDIR=$__worfy_user_zdotdir
  else
    builtin typeset -g +x ZDOTDIR=$__worfy_user_zdotdir
  fi
}

# After a file of the user: remembers the ZDOTDIR it left, then points ZDOTDIR at worfy's folder
# again (not exported) for zsh's next startup file.
__worfy_zdotdir_worfy() {
  builtin emulate -L zsh
  if (( ${+ZDOTDIR} )) && [[ $ZDOTDIR != "$__worfy_dir" ]]; then
    __worfy_user_zdotdir_set=1
    __worfy_user_zdotdir=$ZDOTDIR
    [[ ${(t)ZDOTDIR} == *export* ]] && __worfy_user_zdotdir_export=1 || __worfy_user_zdotdir_export=0
  elif (( ! ${+ZDOTDIR} )); then
    __worfy_user_zdotdir_set=0
    __worfy_user_zdotdir=$HOME
  fi
  builtin typeset -g +x ZDOTDIR=$__worfy_dir
}

if [[ -f $__worfy_user_zdotdir/.zshenv && $__worfy_user_zdotdir != "$__worfy_dir" ]]; then
  __worfy_zdotdir_user
  builtin source "${ZDOTDIR:-$HOME}/.zshenv"
fi
__worfy_zdotdir_worfy
