# worfy: the .zprofile of a Terminal's zsh (a login shell); reads the user's .zprofile (zshenv.zsh).
if [[ -o login && -f $__worfy_user_zdotdir/.zprofile && $__worfy_user_zdotdir != "$__worfy_dir" ]]; then
  __worfy_zdotdir_user
  builtin source "${ZDOTDIR:-$HOME}/.zprofile"
  __worfy_zdotdir_worfy
fi
