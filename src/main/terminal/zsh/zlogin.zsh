# worfy: the .zlogin of a Terminal's zsh (a login shell). The last file worfy's ZDOTDIR is read for:
# the user's ZDOTDIR comes back before the user's .zlogin, so a zsh started from the Terminal runs
# without worfy (zshenv.zsh).
__worfy_zdotdir_user
if [[ -o login && -f ${ZDOTDIR:-$HOME}/.zlogin && ${ZDOTDIR:-$HOME} != "$__worfy_dir" ]]; then
  builtin source "${ZDOTDIR:-$HOME}/.zlogin"
fi
