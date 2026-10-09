# worfy: the .zshenv of a Terminal's zsh. ZDOTDIR points at worfy's folder (shell-integration.ts),
# so zsh reads worfy's .zshenv, .zprofile, .zshrc and .zlogin; each reads the user's file of the
# same name from the user's own ZDOTDIR (or HOME), with ZDOTDIR set to that folder while it runs,
# as without worfy. A user file may change ZDOTDIR itself: the next files of the user are then read
# from there. The user's files are only read, never changed.
#
# This first file takes worfy's variables out of the environment into shell variables that are not
# exported: programs started from the shell do not see the nonce.
__worfy_dir=$ZDOTDIR
__worfy_user_zdotdir=${WORFY_USER_ZDOTDIR:-$HOME}
__worfy_nonce=$WORFY_SHELL_NONCE
builtin unset WORFY_USER_ZDOTDIR WORFY_SHELL_NONCE

if [[ -f $__worfy_user_zdotdir/.zshenv && $__worfy_user_zdotdir != "$__worfy_dir" ]]; then
  ZDOTDIR=$__worfy_user_zdotdir
  builtin source "$ZDOTDIR/.zshenv"
  __worfy_user_zdotdir=${ZDOTDIR:-$HOME}
  ZDOTDIR=$__worfy_dir
fi
