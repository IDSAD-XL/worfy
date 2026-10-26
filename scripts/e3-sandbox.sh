#!/usr/bin/env bash
# The acceptance sandbox: a machine with an empty Claude home inside one folder of its own, so the
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
#   e3-sandbox.sh move            move a sandbox from the old place in the temp dir (below) to the
#                                 sandbox folder, keeping its Claude Code sign-in (see move_sandbox);
#                                 only under lock-run. Run again, it finishes a move that stopped.
#                                 Until it has run, init and the commands that use the sandbox refuse.
#   e3-sandbox.sh reset           delete the sandbox folder, and nothing else
#   e3-sandbox.sh reset-harness   back to "no Harness" for another acceptance run, keeping the
#                                 sign-in: deletes worfy-harness/, plugins/ and settings.json of the
#                                 sandbox Claude home, and npm/, data/, runs/ of the sandbox
# reset and reset-harness delete only in a folder that carries this script's marker, and refuse
# (exit 2) when the sandbox, its home/ or home/.claude is a link: a link would take them outside.
# A folder without the marker is left as it is; the refusal says how to check it and put the marker back.
#
# Where: ~/Library/Application Support/worfy-e3-sandbox/, with ~ the HOME of the caller, so a run from
# an agent's shell and from the owner's Terminal find the same folder. Not the temp dir: macOS deletes
# files there that nobody has opened for three days (com.apple.bsd.dirhelper, daily at 03:35), the
# marker among them. Not ~/Library/Caches: the system may empty it when the disk runs low. Not
# ~/.claude: that is the owner's own, and the acceptance checks it is left unchanged. Time Machine
# backs the folder up; `tmutil addexclusion <folder>` leaves it out.
# Until worfy-harness ticket 36 the sandbox lived in <per-user temp dir>/worfy-e3-sandbox/
# (`getconf DARWIN_USER_TEMP_DIR`, $TMPDIR of a Terminal); `move` takes it from there. That temp dir
# is still the TMPDIR of the sandbox environment.
# The tests set HOME and E3_SANDBOX_TMP (the temp dir) and E3_LOCK_DIR (the lock folder):
# test/contract/e3-sandbox.test.ts runs the script on temporary folders with them, never on the real
# sandbox or the shared lock.
# E3_LOCK_PAUSE is how long lock-run pauses between two attempts to take the lock, as `sleep` takes it
# (default 20, seconds); it is there for that test, which does not wait 20 seconds.
#
# Inside it:
#   home/           HOME of the sandbox; home/.claude is CLAUDE_CONFIG_DIR, so ~/.claude/worfy-harness/
#                   lands in the sandbox too; home/.gitconfig; home/.zshenv and home/.profile repeat the
#                   variables for the login shell worfy reads its agent environment from (ADR-0007);
#                   home/Library/Keychains is a link to the machine's keychains (see init)
#   npm/            npm_config_prefix: `npm install -g` of qmd stays in the sandbox
#   tools/          links to the machine's claude, node, npm, npx, git, gh and jq, where the caller's
#                   PATH finds them outside the system folders. The PATH this script gives out (env,
#                   run, and the line it writes into .zshenv and .profile) is npm/bin, tools/ and the
#                   system folders: no folder of the machine, so no tool the machine happens to have
#                   (a qmd next to node) comes with it. A zsh login shell of the sandbox still gets
#                   more: /etc/zprofile runs path_helper after .zshenv, which puts /usr/local/bin and
#                   the folders of /etc/paths.d (Homebrew, where it is listed there) in front. The
#                   app reads the environment of its checks, its Sessions and the Harness scripts it
#                   runs (the Epics read) from that shell, so it finds the tools of those folders too. init, env, run and check-gh bring the links up to date, and
#                   exit 1 when they cannot write them; reset-harness keeps the links, as they are
#                   not what an install leaves
#   data/           WORFY_DATA_DIR of the app
#   runs/           working folders of the acceptance runs
#
# GH_CONFIG_DIR is the machine's real gh folder: gh accounts and their sign-in are the owner's, and
# the sandbox only reads them. E3_GH_ACCOUNT names the account to check (default IDSAD-XL). Its
# token is never printed or written anywhere.
set -euo pipefail

MARKER=.worfy-e3-sandbox
# In a sandbox `move` brought from the temp dir: the CLAUDE_CONFIG_DIR it had there, which the sandbox
# environment gives Claude Code as CLAUDE_SECURESTORAGE_CONFIG_DIR, so it finds its sign-in (see
# move_sandbox). Deleting the file and running init drops the variable.
SECURE_DIR_FILE=.claude-securestorage-config-dir
# There while a move is not finished: the old folder, so `move` run again can finish it.
MOVING=.worfy-e3-sandbox-moving
# The first line of home/.zshenv and home/.profile: how a sandbox without its marker is recognised.
ZSHENV_HEAD="# Written by scripts/e3-sandbox.sh: the sandbox variables for its login shells."
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

# The folder the sandbox lives in: Library/Application Support of the caller's HOME, checked like the
# temp dir. A HOME inside a sandbox is the sandbox's own (a caller in its environment): the folder
# would be a second sandbox inside the first.
sandbox_parent() {
  local home=${HOME:-}
  [ -n "$home" ] || die 2 "HOME is not set"
  [ -d "$home" ] || die 2 "HOME is not a folder: $home"
  home=$(cd "$home" && pwd -P)
  [ "$home" != "/" ] || die 2 "HOME resolves to /"
  [ -O "$home" ] || die 2 "HOME is not owned by $(id -un): $home"
  case "$home/" in
    */worfy-e3-sandbox/*) die 2 "HOME is $home, inside a sandbox: run this script from the machine's own shell, not the sandbox environment" ;;
  esac
  printf '%s\n' "$home/Library/Application Support"
}

ROOT="$(sandbox_parent)/worfy-e3-sandbox"
# Where the sandbox lived before it moved out of the temp dir: what `move` takes from.
OLD_ROOT="$(temp_root)/worfy-e3-sandbox"
SBX_HOME="$ROOT/home"
SBX_CLAUDE="$SBX_HOME/.claude"
REAL_HOME=${HOME:?HOME is not set}
GH_DIR=${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$REAL_HOME/.config}/gh}

TOOLS_DIR="$ROOT/tools"
SYSTEM_PATH=/usr/bin:/bin:/usr/sbin:/sbin
# The tools of the machine the sandbox finds besides those of the system folders: what the first-run
# screen checks (claude, git, gh, node, jq), what the app installs qmd with (npm, and npx next to
# it), and what the acceptance run and the Harness scripts call (git, gh, node, jq, claude). qmd is
# not one of them: the sandbox has a qmd only when the app has installed it into npm/bin.
TOOLS=(claude node gh jq git npm npx)

# Where the caller's PATH finds a tool: an absolute path, or nothing.
machine_tool() {
  local found
  found=$(command -v "$1" 2>/dev/null || true)
  case "$found" in /*) printf '%s\n' "$found" ;; esac
}

# The PATH this script gives out: what npm installs in the sandbox, the links to the tools above, the
# system folders. No folder of the machine is on it: such a folder holds other tools too (a qmd next
# to node), and the app would take them for installed. That holds for env, run and the line written
# into .zshenv and .profile. The zsh login shell the app reads the environment of its checks, its
# Sessions and the Harness scripts it runs from gets /usr/local/bin and the folders of /etc/paths.d
# in front of it, from /etc/zprofile.
# A link that leads nowhere is not a tool: the warning is about what can be run.
tool_path() {
  local tool
  for tool in "${TOOLS[@]}"; do
    [ -n "$(machine_tool "$tool")" ] || [ -x "$TOOLS_DIR/$tool" ] || echo "e3-sandbox: $tool is not on the PATH; the sandbox will be without it" >&2
  done
  printf '%s\n' "$ROOT/npm/bin:$TOOLS_DIR:$SYSTEM_PATH"
}

# Makes the links of tools/ point at the tools the caller's PATH finds now. Every command that gives
# out the sandbox environment comes through here, so a sandbox made before tools/ existed gets it
# without being made again. Without a sandbox it does nothing.
# - A tool of a system folder gets no link, and loses the one it had: the sandbox PATH finds it there.
# - A tool the caller's PATH does not have keeps its link: a caller with a shorter PATH must not take
#   a tool from an app that is running in the sandbox.
# - A tool that is the same file as its link is left alone. Either the link is right already, and
#   writing it again would take it away for a moment; or the caller found the link itself — its PATH
#   names tools/ (by this path or another one to the same folder) or a link that leads here — and
#   pointing the link at what was found would point it at itself. The files are compared, not their
#   paths: /tmp/x and /private/tmp/x are one folder.
# - Anything else the caller finds inside the sandbox is not a tool of the machine: no link to it.
# A write that fails ends the script with exit 1 and says which: the environment given out after it
# would be without that tool. That does not depend on `set -e`, which is off in a `&&` list.
link_tools() {
  [ -f "$ROOT/$MARKER" ] || return 0
  local dir tool found link
  # Through a link the tools would be linked into the folder it points at.
  for dir in "$ROOT" "$TOOLS_DIR"; do
    [ ! -L "$dir" ] || die 2 "$dir is a link: refusing to work through it"
  done
  mkdir -p "$TOOLS_DIR" || die 1 "cannot make $TOOLS_DIR: the sandbox would be without the tools of the machine"
  for tool in "${TOOLS[@]}"; do
    link="$TOOLS_DIR/$tool"
    found=$(machine_tool "$tool")
    if [ -z "$found" ] || [ "$found" -ef "$link" ]; then continue; fi
    case "$found" in "$ROOT"/*) continue ;; esac
    case ":$SYSTEM_PATH:" in
      *":$(dirname "$found"):"*)
        # Only a link is removed: a file or a folder of that name is not this script's.
        if [ -L "$link" ]; then rm -f -- "$link" || die 1 "cannot remove the link $link"; fi
        ;;
      # -n: a link that points at a folder is replaced, not followed into that folder.
      *) ln -sfn "$found" "$link" || die 1 "cannot write the link $link: the sandbox would be without $tool" ;;
    esac
  done
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
  if [ -f "$ROOT/$SECURE_DIR_FILE" ]; then
    printf 'CLAUDE_SECURESTORAGE_CONFIG_DIR=%s\n' "$(cat "$ROOT/$SECURE_DIR_FILE")"
  fi
}

# The variables a login shell of the sandbox must export besides HOME: worfy starts Claude Code with
# the environment of `$SHELL -ilc` from a minimal start (src/main/agent/env.ts), and the Harness
# scripts it runs itself with the same one, so a variable of the app's own process alone would reach
# neither the agent nor the scripts.
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
# $1 is the sandbox folder, ROOT when not given.
inside_sandbox() {
  local root=${1:-$ROOT} dir real
  [ ! -L "$root" ] || die 2 "$root is a link: refusing to work through it"
  for dir in "$root/home" "$root/home/.claude"; do
    [ ! -L "$dir" ] || die 2 "$dir is a link: refusing to work through it"
    [ -d "$dir" ] || continue
    real=$(cd "$dir" && pwd -P)
    case "$real" in
      "$root"/*) ;;
      *) die 2 "$dir is $real, outside $root: refusing to work there" ;;
    esac
  done
}

# A folder of the sandbox's name that is there, is not empty and has no marker is left as it is:
# without the marker it may be someone else's. It may also be the sandbox whose marker was deleted
# (the temp dir's cleaning did that once), so the refusal says how to tell and how to mark it again.
# $1 is the folder. Returns when the marker is there or the folder is empty or missing.
check_marker() {
  [ ! -f "$1/$MARKER" ] || return 0
  [ -n "$(ls -A "$1" 2>/dev/null)" ] || return 0
  {
    echo "e3-sandbox: $1 is there, is not empty and has no $MARKER: not a sandbox of this script, left as it is (nothing in it deleted or changed)"
    echo "e3-sandbox: if it is the acceptance sandbox that lost its marker, it holds home/.claude, tools/, npm/, data/ and runs/, and"
    echo "e3-sandbox:   head -1 '$1/home/.zshenv'"
    echo "e3-sandbox: prints the line this script writes there: $ZSHENV_HEAD"
    echo "e3-sandbox: then put the marker back and run the command again:"
    echo "e3-sandbox:   touch '$1/$MARKER'"
  } >&2
  exit 2
}

# home/.zshenv and home/.profile: the sandbox variables for its login shells.
write_shell_files() {
  {
    echo "$ZSHENV_HEAD"
    shell_exports
  } >"$SBX_HOME/.zshenv" || die 1 "cannot write $SBX_HOME/.zshenv"
  cp "$SBX_HOME/.zshenv" "$SBX_HOME/.profile" || die 1 "cannot write $SBX_HOME/.profile"
}

# No sandbox is made or used at ROOT while the one at the old place in the temp dir waits for `move`
# (it would leave that one to the temp dir's cleaning, and `move` would then find ROOT taken), nor
# while a move into ROOT is unfinished.
check_not_left_behind() {
  [ ! -f "$ROOT/$MOVING" ] || die 2 "the move of the sandbox into $ROOT is not finished: run it again: bash $SCRIPT_DIR/e3-sandbox.sh lock-run bash $SCRIPT_DIR/e3-sandbox.sh move"
  [ ! -f "$ROOT/$MARKER" ] || return 0
  [ -f "$OLD_ROOT/$MARKER" ] || return 0
  die 2 "the sandbox is still at its old place $OLD_ROOT, in the temp dir macOS cleans; nothing made or used at $ROOT. Move it first: bash $SCRIPT_DIR/e3-sandbox.sh lock-run bash $SCRIPT_DIR/e3-sandbox.sh move"
}

init() {
  # A folder of this name that this script did not make is someone else's: marking it would let
  # `reset` delete it.
  check_marker "$ROOT"
  check_not_left_behind
  inside_sandbox
  mkdir -p "$SBX_CLAUDE" "$ROOT/npm/bin" "$ROOT/data" "$ROOT/runs"
  [ -f "$ROOT/$MARKER" ] || printf 'worfy E3 acceptance sandbox, created %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$ROOT/$MARKER"
  link_tools
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
  write_shell_files
  echo "e3-sandbox: $ROOT"
  check_gh
}

require_sandbox() {
  check_marker "$ROOT"
  check_not_left_behind
  [ -f "$ROOT/$MARKER" ] || die 2 "no sandbox at $ROOT: run \`bash $SCRIPT_DIR/e3-sandbox.sh init\` first"
}

run_in() {
  require_sandbox
  [ $# -gt 0 ] || die 2 "run: no command"
  link_tools
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
# so a long run is not taken for abandoned, a lock older than 30 minutes is abandoned and removed,
# with a pause before the next attempt; apart from that only this run's own lock is removed.
# The modification time of a folder in seconds: BSD stat on macOS, GNU stat elsewhere.
mtime_of() {
  if [ "$(uname)" = Darwin ]; then stat -f %m "$1"; else stat -c %Y "$1"; fi
}

lock_run() {
  [ $# -gt 0 ] || die 2 "lock-run: no command"
  local m hb pause=${E3_LOCK_PAUSE:-20}
  until mkdir "$LOCK" 2>/dev/null; do
    m=$(mtime_of "$LOCK" 2>/dev/null) || continue
    # An abandoned lock is removed, and the pause below comes before this run tries to take it. Taking
    # it at once let two runs hold the lock: both read the old time, the first removed the lock and
    # made its own, and the `rmdir` of the second then removed that fresh lock. With the pause every
    # run that read the old time has finished its `rmdir` before any of them makes a lock.
    if [ $(($(date +%s) - m)) -gt 1800 ]; then rmdir "$LOCK" 2>/dev/null || true; fi
    echo "e3-sandbox: waiting for $LOCK" >&2
    sleep "$pause"
  done
  # Its output goes nowhere, so no `sleep` of it can hold the caller's pipe open. It ends once this
  # script is gone (`kill -0 $$`: killed without its trap, by kill -9 or a timeout), so it does not
  # keep an abandoned lock fresh for ever, and once the lock folder is gone; `touch -c` never makes a
  # plain file where the folder was. The lock names no holder, so the heartbeat cannot tell its own
  # lock from one another run made in its place; it only stops when the folder is gone.
  (while sleep 300; do kill -0 $$ 2>/dev/null || exit 0; [ -d "$LOCK" ] || exit 0; touch -c "$LOCK" 2>/dev/null || true; done) >/dev/null 2>&1 &
  hb=$!
  # Every step of the release is guarded: under `set -e` a failing step would end the trap before rmdir.
  # Git Bash and Cygwin (the heartbeat has a /proc/<pid>/winpid): no kill -STOP. There a kill -KILL
  # right after a kill -STOP can leave the heartbeat alive and deaf to every signal, CONT and KILL
  # from outside included, and `wait` for it never returns (measured on the Windows PC: STOP; KILL;
  # CONT; wait hung 16 runs of 40, KILL; wait 0 of 40; this trap's old form, with ps and pkill
  # between STOP and KILL, 7 of 390). Git Bash has no pkill either: the children of the heartbeat are
  # found by /proc/<pid>/ppid before it is killed and ended through Windows (`/usr/bin/kill -f`,
  # TerminateProcess). The heartbeat gets 2 s, is ended through Windows too after 1 s, and `wait`
  # runs only once it is gone. Elsewhere the heartbeat is stopped first, and pkill runs only once ps
  # shows it stopped (STOP is delivered asynchronously), so it starts no new `sleep` after pkill has
  # killed its current one. A fork it began before the stop may still finish after ps shows it
  # stopped, its child showing up later (under load hundreds of ms later, measured on macOS), so
  # every 0.05 s the trap ends any child of the heartbeat that ps shows not yet ended, until three
  # passes in a row find none, at most 2 s, as in the one-PR gate full block of epic-wave (review of
  # #738); CONT after KILL. A zombie child does not count: the stopped heartbeat cannot reap it, and
  # on Linux `pkill -P` matches a zombie, so a loop on its exit code ran all 2 s every time.
  # shortcut: kills by pid, so a pid reused after the heartbeat already ended gets the signals, and where the 2 s wait for the stop runs out (macOS, Linux) pkill does not wait for it; in Git Bash a `sleep` the heartbeat is still starting is not in /proc yet and runs out its 300 s on /dev/null; and a heartbeat whose script's pid went to another process keeps a lock left by kill -9 fresh while that process lives; redo with a process group (and a holder in the lock) if any of these is ever seen.
  trap 'if [ -e /proc/'"$hb"'/winpid ]; then { c=; for f in /proc/[0-9]*/ppid; do read -r p 2>/dev/null <"$f" && [ "$p" = '"$hb"' ] && { f=${f%/ppid}; c="$c ${f#/proc/}"; }; done; kill -KILL '"$hb"'; [ -z "$c" ] || /usr/bin/kill -f -9 $c; w=0; while [ "$w" -lt 20 ] && kill -0 '"$hb"'; do w=$((w + 1)); [ "$w" != 10 ] || /usr/bin/kill -f -9 '"$hb"'; sleep 0.1; done; kill -0 '"$hb"' || wait '"$hb"'; } 2>/dev/null || true; else kill -STOP '"$hb"' 2>/dev/null || true; w=0; while [ "$w" -lt 200 ] && ps -o stat= -p '"$hb"' 2>/dev/null | grep -qv T; do w=$((w + 1)); sleep 0.01; done; pkill -P '"$hb"' 2>/dev/null || true; e=0; w=0; while [ "$e" -lt 3 ] && [ "$w" -lt 40 ]; do sleep 0.05; w=$((w + 1)); k=; for p in $(ps -A -o pid=,ppid=,stat= | awk -v h='"$hb"' "BEGIN { while ((getline l) > 0) if (split(l, f) == 3 && f[2] == h && f[3] ~ /^[^Z]/) print f[1] }"); do kill "$p" 2>/dev/null || true; k=1; done; if [ -n "$k" ]; then e=0; else e=$((e + 1)); fi; done; kill -KILL '"$hb"' 2>/dev/null || true; kill -CONT '"$hb"' 2>/dev/null || true; wait '"$hb"' 2>/dev/null || true; fi; rmdir "'"$LOCK"'" 2>/dev/null || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  E3_LOCK_HELD=1 "$@"
}

# Deleting is allowed only in a folder this script made: its marker is there, its name is the
# sandbox's, and neither it nor its home/ and home/.claude is a link.
deletable_root() {
  check_marker "$ROOT"
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

# The name of the keychain item Claude Code keeps its sign-in under on macOS for a CLAUDE_CONFIG_DIR:
# "Claude Code-credentials-" and the first 8 hex digits of the SHA-256 of that value as it is written,
# not of the folder it names (read from the claude binary of @anthropic-ai/claude-agent-sdk 0.3.289,
# the functions that build the service name and the config dir). So a new path is a new item.
keychain_item() {
  local sum
  if command -v shasum >/dev/null 2>&1; then sum=$(printf '%s' "$1" | shasum -a 256); else sum=$(printf '%s' "$1" | sha256sum); fi
  printf 'Claude Code-credentials-%s\n' "${sum:0:8}"
}

# Writes the file $1 again with every $2 in it replaced by $3, keeping its last newline. A loop,
# not ${text//old/new} or sed: bash 3.2 of macOS keeps the quotes of a quoted replacement, and bash
# 5.2 and sed put the match in place of an & in it.
rewrite_paths() {
  local text out=
  text=$(cat -- "$1" && printf x) || die 1 "cannot read $1"
  text=${text%x}
  while [[ $text == *"$2"* ]]; do
    out+=${text%%"$2"*}$3
    text=${text#*"$2"}
  done
  printf '%s' "$out$text" >"$1" || die 1 "cannot write $1"
}

# The e2e lock is held: lock-run says so in E3_LOCK_HELD, and its folder is there. $1 is the command
# to run instead.
require_lock() {
  [ "${E3_LOCK_HELD:-}" = 1 ] && [ -d "$LOCK" ] || die 2 "move: run it under the e2e lock $LOCK, so no acceptance run uses the sandbox meanwhile: $1"
}

# Moves the sandbox from OLD_ROOT (the temp dir) to ROOT as a whole: one `mv`, so links inside stay
# links. Then finish_move points the links into the old folder at the new one, rewrites the paths of
# home/.gitconfig and writes home/.zshenv and home/.profile for the new place.
# The sign-in is kept through an undocumented variable. Claude Code on macOS finds it in the keychain
# under a name made from CLAUDE_CONFIG_DIR (keychain_item), and that path changes. When
# CLAUDE_SECURESTORAGE_CONFIG_DIR is set, the name is made from it instead (the claude binary of
# claude-agent-sdk 0.3.289 and claude 2.1.300), so the moved sandbox keeps the old CLAUDE_CONFIG_DIR
# there (SECURE_DIR_FILE). Should Claude Code stop reading it, the owner signs in again.
# Only under the e2e lock (lock-run): an app running in the sandbox would lose its folder.
# shortcut: rewrites only the spelling OLD_ROOT has (resolved, /private/var/folders/...), not /var/folders/...; redo if a link or .gitconfig ever names the old folder that way.
move_sandbox() {
  [ $# -eq 0 ] || die 2 "move: takes no options, not $1"
  local lock_hint="bash $SCRIPT_DIR/e3-sandbox.sh lock-run bash $SCRIPT_DIR/e3-sandbox.sh move" old
  # A move that stopped after mv (a link or a file it could not write) is finished, not started again.
  if [ -f "$ROOT/$MOVING" ]; then
    require_lock "$lock_hint"
    inside_sandbox
    old=$(cat "$ROOT/$MOVING")
    # A marker still at the old place means mv did not finish (across volumes it copies, then deletes):
    # what is at ROOT may be a part of the sandbox only.
    [ ! -f "$old/$MARKER" ] || die 2 "$old still has $MARKER: the mv into $ROOT did not finish, and $ROOT may hold a part of the sandbox only. Compare the two folders; keep the whole one at $old, delete $ROOT, then run: $lock_hint"
    finish_move "$old"
    return 0
  fi
  # Moved already. Claude Code makes the old home/.claude again, with a lock file in it, before each
  # write of the sign-in: it is the CLAUDE_SECURESTORAGE_CONFIG_DIR of the moved sandbox.
  if [ -f "$ROOT/$MARKER" ] && [ ! -L "$ROOT" ] && [ -f "$ROOT/$SECURE_DIR_FILE" ] && [ "$(cat "$ROOT/$SECURE_DIR_FILE")" = "$OLD_ROOT/home/.claude" ]; then
    echo "e3-sandbox: the sandbox was moved from $OLD_ROOT to $ROOT already: nothing to do"
    return 0
  fi
  if [ ! -e "$OLD_ROOT" ] && [ ! -L "$OLD_ROOT" ]; then
    echo "e3-sandbox: no sandbox at $OLD_ROOT: nothing to move"
    return 0
  fi
  # Without the marker and without the .zshenv this script writes it is no sandbox that lost its marker
  # (that is what Claude Code leaves there, see above): nothing to move, and no advice to mark it.
  if [ ! -L "$OLD_ROOT" ] && [ ! -f "$OLD_ROOT/$MARKER" ] && [ ! -f "$OLD_ROOT/home/.zshenv" ]; then
    echo "e3-sandbox: $OLD_ROOT has no $MARKER and no home/.zshenv: no sandbox there, nothing to move; the folder is left as it is"
    return 0
  fi
  check_marker "$OLD_ROOT"
  [ -f "$OLD_ROOT/$MARKER" ] || die 2 "$OLD_ROOT has no $MARKER: not a sandbox of this script, left as it is"
  inside_sandbox "$OLD_ROOT"
  local file
  for file in .zshenv .profile .gitconfig; do
    [ ! -L "$OLD_ROOT/home/$file" ] || die 2 "$OLD_ROOT/home/$file is a link: refusing to write through it; nothing moved"
  done
  if [ -e "$ROOT" ] || [ -L "$ROOT" ]; then
    if [ -f "$ROOT/$MARKER" ] && [ ! -L "$ROOT" ]; then
      die 2 "$ROOT holds a sandbox already: nothing moved; the old one stays at $OLD_ROOT. If that one at $ROOT is a fresh one with nothing to keep (no sign-in), delete it with \`bash $SCRIPT_DIR/e3-sandbox.sh reset\`, then run the move again: $lock_hint"
    fi
    [ -d "$ROOT" ] && [ ! -L "$ROOT" ] && [ -z "$(ls -A "$ROOT" 2>/dev/null)" ] ||
      die 2 "$ROOT is there already and is not an empty folder nor a sandbox of this script: nothing moved; the sandbox stays at $OLD_ROOT. Move $ROOT out of the way yourself, then run the move again: $lock_hint"
  fi
  require_lock "$lock_hint"
  # An empty folder in the way is removed; mv would put the sandbox inside it.
  if [ -d "$ROOT" ]; then rmdir -- "$ROOT" || die 1 "cannot remove the empty folder $ROOT"; fi
  mkdir -p -- "$(dirname "$ROOT")" || die 1 "cannot make $(dirname "$ROOT")"
  printf '%s\n' "$OLD_ROOT" >"$OLD_ROOT/$MOVING" || die 1 "cannot write $OLD_ROOT/$MOVING; nothing moved"
  mv -- "$OLD_ROOT" "$ROOT" || die 1 "cannot move $OLD_ROOT to $ROOT"
  # A ROOT made between the check above and mv takes the sandbox inside it.
  [ -f "$ROOT/$MARKER" ] || die 1 "after mv $ROOT has no $MARKER: a folder appeared there meanwhile and the sandbox is $ROOT/$(basename "$OLD_ROOT"). Move that folder to $ROOT yourself, then run: $lock_hint"
  finish_move "$OLD_ROOT"
}

# The steps after mv; run again they do the same. $1 is the folder the sandbox was moved from.
finish_move() {
  local old=$1 link target file
  [ -n "$old" ] || die 2 "$ROOT/$MOVING names no old folder"
  while IFS= read -r -d '' link; do
    target=$(readlink "$link")
    case "$target" in
      "$old" | "$old"/*) ln -sfn "$ROOT${target#"$old"}" "$link" || die 1 "cannot point $link into $ROOT; fix that, then run: bash $SCRIPT_DIR/e3-sandbox.sh lock-run bash $SCRIPT_DIR/e3-sandbox.sh move" ;;
    esac
  done < <(find "$ROOT" -type l -print0)
  for file in .zshenv .profile .gitconfig; do
    [ ! -L "$SBX_HOME/$file" ] || die 2 "$SBX_HOME/$file is a link: refusing to write through it"
  done
  [ ! -f "$SBX_HOME/.gitconfig" ] || rewrite_paths "$SBX_HOME/.gitconfig" "$old" "$ROOT"
  # A sandbox moved twice keeps the first CLAUDE_CONFIG_DIR: its sign-in is filed under that one.
  [ -f "$ROOT/$SECURE_DIR_FILE" ] || printf '%s\n' "$old/home/.claude" >"$ROOT/$SECURE_DIR_FILE" || die 1 "cannot write $ROOT/$SECURE_DIR_FILE"
  write_shell_files
  rm -f -- "$ROOT/$MOVING" || die 1 "cannot remove $ROOT/$MOVING"
  echo "e3-sandbox: moved $old to $ROOT"
  echo "e3-sandbox: the sign-in stays: Claude Code still looks for the keychain item '$(keychain_item "$(cat "$ROOT/$SECURE_DIR_FILE")")', as the sandbox environment sets CLAUDE_SECURESTORAGE_CONFIG_DIR=$(cat "$ROOT/$SECURE_DIR_FILE")."
  echo "e3-sandbox: that variable is undocumented; if Claude Code stops reading it, sign in again: bash $SCRIPT_DIR/e3-sandbox.sh shell"
  echo "e3-sandbox: files of the Claude home may still name the old folder (the plugin records): run reset-harness before the next acceptance run"
}

case "${1:-}" in
  init) init ;;
  check-gh)
    require_sandbox
    link_tools
    check_gh
    ;;
  env)
    link_tools
    sandbox_env
    ;;
  run) shift && run_in "$@" ;;
  shell) print_shell ;;
  lock-run) shift && lock_run "$@" ;;
  path) echo "$ROOT" ;;
  move) shift && move_sandbox "$@" ;;
  reset) reset ;;
  reset-harness) reset_harness ;;
  *) die 2 "usage: e3-sandbox.sh init|check-gh|env|run <cmd>...|shell|lock-run <cmd>...|path|move|reset|reset-harness" ;;
esac
