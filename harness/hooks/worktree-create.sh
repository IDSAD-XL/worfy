#!/usr/bin/env bash
# WorktreeCreate draft: where Claude Code would put the worktree of a subagent started with
# `isolation: "worktree"` (and of `claude --worktree`).
#
# NOT REGISTERED. hooks.json does not run this script (owner decision 2026-10-09): a plugin hook is
# machine-wide, and this script would replace Claude Code's own worktree creation in every session of
# every repository — without its reuse of an existing tree, its cleanup of unchanged trees, fetch,
# .worktreeinclude, sparsePaths or baseRef. It stays here as documentation for the day
# a project with a `worktree.root` outside the repository is connected. Until then subagent
# work outside the repository is not supported.
#
# What is known. Claude Code lets a subagent edit files only in its own worktree, and it creates that
# worktree itself under .claude/worktrees/ of the repository. A project whose `worktree.root` lies
# outside the repository (`<HARNESS_HOME>/worktrees/<project>/`) needs the tree there; with
# a WorktreeCreate hook configured Claude Code does not create the tree at all — it runs the hook and
# pins the subagent to the path the hook prints. Live probes 2026-10-08:
# the subagent's cwd is the printed path, Edit, Write and git work there, and Claude Code never removes
# such a tree. Those probes ran ANOTHER script (wt-create.sh) given through `claude -p --settings`;
# this script through the plugin's hooks.json was never probed.
#
# Input (stdin JSON): `name` (Claude Code's, e.g. "agent-a6ab0372015501760" — not the ticket number)
# and `cwd` (the session's directory). Output: the absolute path of the new worktree on stdout,
# git's messages on stderr; exit 1 — Claude Code reports the failure and starts no subagent.
#
# - The project's profile (bin/profile -C <cwd>) has `worktree.root` outside the repository and a
#   `worktree.implementer` template: the template runs from the repository's main checkout with
#   <NN> and <ticket-name> = <name>, <branch> = worktree-<name>; the tree it adds is the answer. The
#   implementer renames the branch to the ticket's branch in its tree (`git branch -m`).
# - Anything else (no profile, `worktree.root` inside the repository or empty, no template): only the
#   location Claude Code uses without a hook — `<repository>/.claude/worktrees/<name>` on a new branch
#   `worktree-<name>`, from the branch origin/HEAD points to, else from HEAD. It is NOT Claude Code's
#   behaviour: a repeated name fails instead of reusing the tree, and nothing removes the tree.
#
# For tests: CLAUDE_PROFILE_BIN — the profile script.

set -uo pipefail
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# The git of an eval run: EVAL_GIT, else git from PATH (hooks/eval-env.cjs). The worktree.implementer
# template runs in a shell of its own and starts git from PATH.
git() { command "${EVAL_GIT:-git}" "$@"; }

PROFILE_BIN="${CLAUDE_PROFILE_BIN:-$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/.." && pwd -P)/bin/profile}"

input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"
name="$(printf '%s' "$input" | jq -r '.name // empty' 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd="$PWD"
# Claude Code's names: "/"-separated segments of letters, digits, ".", "_" and "-".
case "/$name/" in
    // | *//* | */./* | */../* | *[!A-Za-z0-9._/-]*) echo "worktree-create: bad worktree name '$name'" >&2; exit 1 ;;
esac

common="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
    || { echo "worktree-create: $cwd is not in a git repository" >&2; exit 1; }
# The main checkout: the first entry of `git worktree list`.
top="$(git -C "$cwd" worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')"
[ -n "$top" ] && [ -d "$top" ] || { echo "worktree-create: no main checkout for $common" >&2; exit 1; }
top="$(cd "$top" && pwd -P)"

trees() { git -C "$top" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | sort; }

root="$("$PROFILE_BIN" -C "$cwd" --field worktree.root 2>/dev/null)" || root=""
tmpl="$("$PROFILE_BIN" -C "$cwd" --field worktree.implementer 2>/dev/null)" || tmpl=""
[ "$root" = null ] && root=""
[ "$tmpl" = null ] && tmpl=""
outside=""
if [ -n "$root" ] && [ -n "$tmpl" ] && [ "${root#/}" != "$root" ]; then
    # Compare real paths: the root may not exist yet, so resolve its nearest existing parent.
    p="${root%/}"; rest=""
    while [ -n "$p" ] && [ ! -d "$p" ]; do rest="/${p##*/}$rest"; p="${p%/*}"; done
    real="$(cd "${p:-/}" && pwd -P)$rest"
    case "$real/" in "$top"/*) ;; *) outside=1 ;; esac
fi

if [ -n "$outside" ]; then
    cmd="${tmpl//<NN>/$name}"; cmd="${cmd//<ticket-name>/$name}"; cmd="${cmd//<branch>/worktree-$name}"
    # shortcut: accepts the old Russian token, remove after the next release
    cmd="${cmd//<имя-тикета>/$name}"; cmd="${cmd//<ветка>/worktree-$name}"
    case "$cmd" in *'<'*'>'*) echo "worktree-create: unknown placeholder left in worktree.implementer: $cmd" >&2; exit 1 ;; esac
    before="$(trees)"
    mkdir -p "$root" || exit 1
    (cd "$top" && bash -c "$cmd") >&2 || { echo "worktree-create: worktree.implementer failed: $cmd" >&2; exit 1; }
    new="$(comm -13 <(printf '%s\n' "$before") <(trees))"
    if [ -z "$new" ] || [ "$(printf '%s\n' "$new" | wc -l | tr -d ' ')" != 1 ]; then
        echo "worktree-create: worktree.implementer added no single worktree: $cmd" >&2; exit 1
    fi
    printf '%s\n' "$new"
    exit 0
fi

base="$(git -C "$top" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)" || base=""
[ -n "$base" ] || base=HEAD
dir="$top/.claude/worktrees/$name"
mkdir -p "$top/.claude/worktrees" || exit 1
git -C "$top" worktree add -q -b "worktree-$name" "$dir" "$base" >&2 || exit 1
printf '%s\n' "$dir"
