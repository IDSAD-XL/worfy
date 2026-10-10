#!/usr/bin/env bash
# The acceptance sandbox: a machine with an empty Claude home inside one temporary folder, so the
# packaged worfy.app installs its Harness, qmd and the Profiles there and never in the real ~/.claude.
#
#   e3-sandbox.sh init            create the sandbox (or keep the one there), write its .gitconfig and
#                                 shell files, then check gh (below); exit 3 when gh has no token;
#                                 exit 2 when the folder is there, not empty and not this script's
#   e3-sandbox.sh check-gh        `gh auth token -u <account>` in the sandbox environment: exit 0 or 3
#   e3-sandbox.sh env             the sandbox environment, one KEY=VALUE per line
#   e3-sandbox.sh run <cmd>...    run a command in the sandbox environment only (env -i)
#   e3-sandbox.sh shell           print the owner's commands: sign in to Claude Code in the sandbox
#   e3-sandbox.sh lock-run <cmd>... run a command (in the caller's environment) under the shared
#                                 Electron lock /tmp/worfy-e2e.lock, with E3_LOCK_HELD=1
#   e3-sandbox.sh path            print the sandbox folder
#   e3-sandbox.sh reset           delete the sandbox folder, and nothing else
#   e3-sandbox.sh reset-harness   back to "no Harness" for another acceptance run, keeping the
#                                 sign-in: deletes worfy-harness/, plugins/ and settings.json of the
#                                 sandbox Claude home, and npm/, data/, runs/ of the sandbox
# reset and reset-harness delete only in a folder that carries this script's marker, and refuse
# (exit 2) when the sandbox, its home/ or home/.claude is a link: a link would take them outside.
#
# Where: <per-user temp dir>/worfy-e3-sandbox/ — `getconf DARWIN_USER_TEMP_DIR`, which is $TMPDIR
# of a Terminal, so a run from an agent's shell and from the owner's Terminal find the same folder.
# E3_SANDBOX_TMP replaces that temp dir and E3_LOCK_DIR the lock folder: test/contract/e3-sandbox.test.ts
# runs the script on temporary folders with them, never on the real sandbox or the shared lock.
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

# The sandbox and the two folders this script writes into and deletes from are real folders inside
# it, not links: through a link `reset-harness` would delete in the folder the link points at.
inside_sandbox() {
  [ ! -L "$ROOT" ] || die 2 "$ROOT is a link: refusing to work through it"
  local dir real
  for dir in "$SBX_HOME" "$SBX_CLAUDE"; do
    [ ! -L "$dir" ] || die 2 "$dir is a link: refusing to work through it"
    [ -d "$dir" ] || continue
    real=$(cd "$dir" && pwd -P)
    case "$real" in
      "$ROOT"/*) ;;
      *) die 2 "$dir is $real, outside $ROOT: refusing to work there" ;;
    esac
  done
}

init() {
  # A folder of this name that this script did not make is someone else's: marking it would let
  # `reset` delete it.
  if [ -e "$ROOT" ] && [ ! -f "$ROOT/$MARKER" ] && [ -n "$(ls -A "$ROOT" 2>/dev/null)" ]; then
    die 2 "$ROOT is there, is not empty and has no $MARKER: not a sandbox of this script, left as it is"
  fi
  inside_sandbox
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
# The modification time of a folder in seconds: BSD stat on macOS, GNU stat elsewhere.
mtime_of() {
  if [ "$(uname)" = Darwin ]; then stat -f %m "$1"; else stat -c %Y "$1"; fi
}

lock_run() {
  [ $# -gt 0 ] || die 2 "lock-run: no command"
  local m hb
  until mkdir "$LOCK" 2>/dev/null; do
    m=$(mtime_of "$LOCK" 2>/dev/null) || continue
    # An abandoned lock is removed and taken at once; a live one is waited for.
    if [ $(($(date +%s) - m)) -gt 1800 ] && rmdir "$LOCK" 2>/dev/null; then continue; fi
    echo "e3-sandbox: waiting for $LOCK" >&2
    sleep 20
  done
  # Its output goes nowhere: the `sleep` it leaves behind would otherwise hold the caller's pipe
  # open for up to 5 minutes after this script has exited.
  (while sleep 300; do touch "$LOCK" 2>/dev/null || exit 0; done) >/dev/null 2>&1 &
  hb=$!
  # Every step of the release is guarded: under `set -e` a failing step would end the trap before rmdir.
  trap 'kill '"$hb"' 2>/dev/null || true; wait '"$hb"' 2>/dev/null || true; rmdir "'"$LOCK"'" 2>/dev/null || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  E3_LOCK_HELD=1 "$@"
}

# Deleting is allowed only in a folder this script made: its marker is there, its name is the
# sandbox's, and neither it nor its home/ and home/.claude is a link.
deletable_root() {
  [ -f "$ROOT/$MARKER" ] || die 2 "$ROOT has no $MARKER: not a sandbox of this script, left as it is"
  case "$ROOT" in
    /*/worfy-e3-sandbox) ;;
    *) die 2 "refusing to delete in $ROOT" ;;
  esac
  inside_sandbox
}

reset() {
  [ -e "$ROOT" ] || {
    echo "e3-sandbox: no sandbox at $ROOT"
    return 0
  }
  deletable_root
  rm -rf -- "$ROOT"
  echo "e3-sandbox: removed $ROOT"
}

# What an install leaves: the Harness copy, Claude Code's plugin records (plugins/, and settings.json,
# which the sandbox does not have before an install), qmd under the npm prefix, the app's data and
# the runs' folders. The sign-in (.claude.json of the Claude home, the keychain item) stays.
reset_harness() {
  require_sandbox
  deletable_root
  rm -rf -- "$SBX_CLAUDE/worfy-harness" "$SBX_CLAUDE/plugins" "$SBX_CLAUDE/settings.json" "$ROOT/npm" "$ROOT/data" "$ROOT/runs"
  mkdir -p "$ROOT/npm/bin" "$ROOT/data" "$ROOT/runs"
  echo "e3-sandbox: no Harness in $ROOT now; the sign-in is kept"
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
  reset-harness) reset_harness ;;
  *) die 2 "usage: e3-sandbox.sh init|check-gh|env|run <cmd>...|shell|lock-run <cmd>...|path|reset|reset-harness" ;;
esac
