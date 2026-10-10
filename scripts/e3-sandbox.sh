#!/usr/bin/env bash
# The acceptance sandbox: a machine with an empty Claude home inside one temporary folder, so the
# packaged worfy.app installs its Harness, qmd and the Profiles there and never in the real ~/.claude.
#
#   e3-sandbox.sh init            create the sandbox (or keep the one there), write its .gitconfig and
#                                 shell files, then check gh (below); exit 3 when gh has no token
#   e3-sandbox.sh check-gh        `gh auth token -u <account>` in the sandbox environment: exit 0 or 3
#   e3-sandbox.sh env             the sandbox environment, one KEY=VALUE per line
#   e3-sandbox.sh run <cmd>...    run a command in the sandbox environment only (env -i)
#   e3-sandbox.sh shell           print the owner's commands: sign in to Claude Code in the sandbox
#   e3-sandbox.sh lock-run <cmd>... run a command (in the caller's environment) under the shared
#                                 Electron lock /tmp/worfy-e2e.lock, with E3_LOCK_HELD=1
#   e3-sandbox.sh path            print the sandbox folder
#   e3-sandbox.sh reset           delete the sandbox folder, and nothing else
#
# Where: <per-user temp dir>/worfy-e3-sandbox/ — `getconf DARWIN_USER_TEMP_DIR`, which is $TMPDIR
# of a Terminal, so a run from an agent's shell and from the owner's Terminal find the same folder.
# E3_SANDBOX_TMP replaces that temp dir and E3_LOCK_DIR the lock folder (this script's own tests).
#
# Inside it:
#   home/           HOME of the sandbox; home/.claude is CLAUDE_CONFIG_DIR, so ~/.claude/worfy-harness/
#                   lands in the sandbox too; home/.gitconfig; home/.zshenv and home/.profile repeat the
#                   variables for the login shell worfy reads its agent environment from (ADR-0007);
#                   home/Library/Keychains is a link to the machine's keychains (see init)
#   npm/            npm_config_prefix: `npm install -g` of qmd stays in the sandbox
#   data/           WORFY_DATA_DIR of the app
#   runs/           working folders of the acceptance runs
#
# GH_CONFIG_DIR is the machine's real gh folder: gh accounts and their sign-in are the owner's, and
# the sandbox only reads them. E3_GH_ACCOUNT names the account to check (default IDSAD-XL). Its
# token is never printed or written anywhere.
set -euo pipefail

MARKER=.worfy-e3-sandbox
LOCK=${E3_LOCK_DIR:-/tmp/worfy-e2e.lock}
ACCOUNT=${E3_GH_ACCOUNT:-IDSAD-XL}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

die() {
  echo "e3-sandbox: $2" >&2
  exit "$1"
}

# The temp dir the sandbox lives in, checked: an existing folder of the current user, not /.
temp_root() {
  local tmp=${E3_SANDBOX_TMP:-}
  if [ -z "$tmp" ]; then tmp=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || true); fi
  if [ -z "$tmp" ]; then tmp=${TMPDIR:-}; fi
  [ -n "$tmp" ] || die 2 "no temp dir: neither DARWIN_USER_TEMP_DIR nor TMPDIR is set"
  [ -d "$tmp" ] || die 2 "the temp dir is not a folder: $tmp"
  tmp=$(cd "$tmp" && pwd -P)
  [ "$tmp" != "/" ] || die 2 "the temp dir resolves to /"
  [ -O "$tmp" ] || die 2 "the temp dir is not owned by $(id -un): $tmp"
  printf '%s\n' "$tmp"
}

ROOT="$(temp_root)/worfy-e3-sandbox"
SBX_HOME="$ROOT/home"
SBX_CLAUDE="$SBX_HOME/.claude"
REAL_HOME=${HOME:?HOME is not set}
GH_DIR=${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$REAL_HOME/.config}/gh}

# The folders of the tools the first-run screen checks, from the caller's PATH, then the system PATH.
tool_path() {
  local path="$ROOT/npm/bin" tool found dir
  for tool in claude node gh jq git npm; do
    found=$(command -v "$tool" 2>/dev/null || true)
    case "$found" in
      /*)
        dir=$(dirname "$found")
        case ":$path:/usr/bin:/bin:/usr/sbin:/sbin:" in *":$dir:"*) ;; *) path="$path:$dir" ;; esac
        ;;
      *) echo "e3-sandbox: $tool is not on the PATH; the first-run screen will say so" >&2 ;;
    esac
  done
  printf '%s\n' "$path:/usr/bin:/bin:/usr/sbin:/sbin"
}

# The sandbox environment: what the app, the owner's `claude` and the checks get, and nothing else.
sandbox_env() {
  local lang=${LANG:-en_US.UTF-8}
  cat <<EOF
HOME=$SBX_HOME
USER=$(id -un)
LOGNAME=$(id -un)
SHELL=/bin/zsh
TMPDIR=$(temp_root)/
LANG=$lang
TERM=${TERM:-xterm-256color}
PATH=$(tool_path)
CLAUDE_CONFIG_DIR=$SBX_CLAUDE
WORFY_CLAUDE_HOME=$SBX_CLAUDE
WORFY_DATA_DIR=$ROOT/data
npm_config_prefix=$ROOT/npm
GH_CONFIG_DIR=$GH_DIR
EOF
}

# The variables a login shell of the sandbox must export besides HOME: worfy starts Claude Code with
# the environment of `$SHELL -ilc` from a minimal start (src/main/agent/env.ts), so a variable of the
# app's own process alone would not reach the agent.
shell_exports() {
  sandbox_env | while IFS='=' read -r key value; do
    case "$key" in
      HOME | USER | LOGNAME | SHELL | TMPDIR | LANG | TERM) ;;
      *) printf "export %s='%s'\n" "$key" "$value" ;;
    esac
  done
}

check_gh() {
  local gh err
  gh=$(command -v gh 2>/dev/null || true)
  [ -n "$gh" ] || {
    echo "e3-sandbox: gh is not on the PATH" >&2
    return 3
  }
  local -a env_args=()
  while IFS= read -r line; do env_args+=("$line"); done < <(sandbox_env)
  # The token goes to /dev/null: only the exit code is wanted.
  if err=$(env -i "${env_args[@]}" "$gh" auth token --hostname github.com -u "$ACCOUNT" 2>&1 >/dev/null); then
    echo "e3-sandbox: gh auth token -u $ACCOUNT in the sandbox environment: exit 0"
    return 0
  fi
  echo "e3-sandbox: gh auth token -u $ACCOUNT in the sandbox environment failed: $err" >&2
  echo "e3-sandbox: GH_CONFIG_DIR=$GH_DIR; with HOME=$SBX_HOME the macOS keychain may not be found" >&2
  return 3
}

init() {
  mkdir -p "$SBX_CLAUDE" "$ROOT/npm/bin" "$ROOT/data" "$ROOT/runs"
  [ -f "$ROOT/$MARKER" ] || printf 'worfy E3 acceptance sandbox, created %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$ROOT/$MARKER"
  # macOS finds the login keychain under $HOME/Library/Keychains. gh keeps its tokens there, so with
  # the sandbox HOME alone `gh auth token` answers "no oauth token found". The keychain is the
  # machine's, like the gh accounts: the sandbox links to it (E3_KEYCHAIN_LINK=0 leaves it out).
  if [ "${E3_KEYCHAIN_LINK:-1}" = 1 ] && [ ! -e "$SBX_HOME/Library/Keychains" ]; then
    mkdir -p "$SBX_HOME/Library"
    ln -s "$REAL_HOME/Library/Keychains" "$SBX_HOME/Library/Keychains"
  fi
  local gh
  gh=$(command -v gh 2>/dev/null || echo gh)
  cat >"$SBX_HOME/.gitconfig" <<EOF
[user]
	name = ${E3_GIT_NAME:-worfy acceptance}
	email = ${E3_GIT_EMAIL:-$ACCOUNT@users.noreply.github.com}
[init]
	defaultBranch = main
[commit]
	gpgsign = false
[credential "https://github.com"]
	helper =
	helper = !$gh auth git-credential
EOF
  {
    echo "# Written by scripts/e3-sandbox.sh: the sandbox variables for its login shells."
    shell_exports
  } >"$SBX_HOME/.zshenv"
  cp "$SBX_HOME/.zshenv" "$SBX_HOME/.profile"
  echo "e3-sandbox: $ROOT"
  check_gh
}

require_sandbox() {
  [ -f "$ROOT/$MARKER" ] || die 2 "no sandbox at $ROOT: run \`bash $SCRIPT_DIR/e3-sandbox.sh init\` first"
}

run_in() {
  require_sandbox
  [ $# -gt 0 ] || die 2 "run: no command"
  local -a env_args=()
  while IFS= read -r line; do env_args+=("$line"); done < <(sandbox_env)
  cd "$SBX_HOME"
  exec env -i "${env_args[@]}" "$@"
}

print_shell() {
  require_sandbox
  cat <<EOF
Sign in to Claude Code in the sandbox (once; the agent does not do it):

  bash $SCRIPT_DIR/e3-sandbox.sh run claude

then, inside Claude Code:

  /login

Choose the subscription sign-in and finish it in the browser, then /exit. The sign-in is kept for
CLAUDE_CONFIG_DIR=$SBX_CLAUDE only; the real ~/.claude is not touched.
Check: /status inside that claude names the account.
The sandbox environment: bash $SCRIPT_DIR/e3-sandbox.sh env
EOF
}

# The shared lock of Electron runs (rules.md of the worfy Profile): mkdir, a touch every 5 minutes
# so a long run is not taken for abandoned, a lock older than 30 minutes is abandoned; only this
# run's own lock is removed.
lock_run() {
  [ $# -gt 0 ] || die 2 "lock-run: no command"
  local m hb
  until mkdir "$LOCK" 2>/dev/null; do
    m=$(stat -f %m "$LOCK" 2>/dev/null) || continue
    if [ $(($(date +%s) - m)) -gt 1800 ]; then rmdir "$LOCK" 2>/dev/null || true; fi
    echo "e3-sandbox: waiting for $LOCK" >&2
    sleep 20
  done
  (while sleep 300; do touch "$LOCK" 2>/dev/null || exit 0; done) &
  hb=$!
  # Every step of the release is guarded: under `set -e` a failing step would end the trap before rmdir.
  trap 'kill '"$hb"' 2>/dev/null || true; wait '"$hb"' 2>/dev/null || true; rmdir "'"$LOCK"'" 2>/dev/null || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  E3_LOCK_HELD=1 "$@"
}

reset() {
  [ -e "$ROOT" ] || {
    echo "e3-sandbox: no sandbox at $ROOT"
    return 0
  }
  [ -f "$ROOT/$MARKER" ] || die 2 "$ROOT has no $MARKER: not a sandbox of this script, left as it is"
  case "$ROOT" in
    /*/worfy-e3-sandbox) ;;
    *) die 2 "refusing to delete $ROOT" ;;
  esac
  rm -rf -- "$ROOT"
  echo "e3-sandbox: removed $ROOT"
}

case "${1:-}" in
  init) init ;;
  check-gh) require_sandbox && check_gh ;;
  env) sandbox_env ;;
  run) shift && run_in "$@" ;;
  shell) print_shell ;;
  lock-run) shift && lock_run "$@" ;;
  path) echo "$ROOT" ;;
  reset) reset ;;
  *) die 2 "usage: e3-sandbox.sh init|check-gh|env|run <cmd>...|shell|lock-run <cmd>...|path|reset" ;;
esac
