# worfy: the .zprofile of a Terminal's zsh (a login shell); reads the user's .zprofile (zshenv.zsh).
if [[ -o login && -f $__worfy_user_zdotdir/.zprofile && $__worfy_user_zdotdir != "$__worfy_dir" ]]; then
  ZDOTDIR=$__worfy_user_zdotdir
  builtin source "$ZDOTDIR/.zprofile"
  __worfy_user_zdotdir=${ZDOTDIR:-$HOME}
  ZDOTDIR=$__worfy_dir
fi
