# worfy: the .zshrc of a Terminal's zsh; reads the user's .zshrc (zshenv.zsh), then worfy's shell
# integration (integration.zsh) and the scripts of rc.d/ in the order of their names.

# The history stays the user's. On macOS /etc/zshrc sets HISTFILE from ZDOTDIR, which is worfy's
# folder by then: it goes back to the user's ZDOTDIR (or HOME), as zsh without worfy would have it.
# A HISTFILE set by the user's .zshenv or .zprofile stays where the system zshrc left it alone, and
# the user's .zshrc may set its own after this. HISTSIZE and SAVEHIST are not touched.
if [[ -z $HISTFILE || $HISTFILE == "$__worfy_dir"/* ]]; then
  HISTFILE=$__worfy_user_zdotdir/.zsh_history
fi

if [[ -f $__worfy_user_zdotdir/.zshrc && $__worfy_user_zdotdir != "$__worfy_dir" ]]; then
  __worfy_zdotdir_user
  builtin source "${ZDOTDIR:-$HOME}/.zshrc"
  __worfy_zdotdir_worfy
fi

# Without the nonce this is not a shell worfy started (say, a zsh run from the user's .zshrc while
# ZDOTDIR was still worfy's): no integration.
if [[ -n $__worfy_nonce && -f $__worfy_dir/integration.zsh ]]; then
  builtin source "$__worfy_dir/integration.zsh"
  # Read at the top level, as the user's files are: a script's `typeset` makes a global, not a local.
  () {
    builtin emulate -L zsh
    builtin typeset -ga __worfy_rc_scripts
    __worfy_rc_scripts=("$__worfy_dir"/rc.d/*.zsh(N))
  }
  for __worfy_rc_script in "${__worfy_rc_scripts[@]}"; do
    builtin source "$__worfy_rc_script"
  done
  builtin unset __worfy_rc_script __worfy_rc_scripts
  # Scripts of rc.d/ may add their own precmd hooks: worfy's comes last (integration.zsh).
  (( ${+functions[__worfy_precmd_last]} )) && __worfy_precmd_last
fi

# `setopt allexport` in the user's .zshrc would export every variable assigned after it at the top
# level; none of worfy's (the nonce is in some) goes to the programs of the Terminal.
() {
  builtin emulate -L zsh
  builtin local name
  for name in ${(k)parameters[(I)__worfy_*]}; do
    builtin typeset -g +x $name
  done
}

# A shell that is not a login shell gets the user's ZDOTDIR back here; a login shell, as a
# Terminal's is, in worfy's .zlogin. Either way a zsh started from the Terminal runs without worfy.
[[ -o login ]] || __worfy_zdotdir_user
