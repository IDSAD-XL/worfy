#!/usr/bin/env bash
# Installs the stable copy of worfy.app outside the repository: Autopilot over worfy itself runs
# on this copy, never on a build that agents are rewriting in their worktrees (README.md, "Stable copy").
#
#   scripts/install-stable.sh [<target>.app]     (pnpm install:stable [<target>.app])
#
# Builds the .app (`pnpm package`), copies dist/mac*/worfy.app to the target (default
# ~/Applications/worfy-stable.app) and replaces a previous copy there. Writes the commit and the
# build time next to the copy, in <target>.json: nothing is written inside the .app after the
# copy, since that would break its ad-hoc signature. Refuses with a non-zero exit code while the
# copy is running.
#
# WORFY_STABLE_PREBUILT=<path to a built worfy.app> skips the build and copies that app instead;
# the e2e tests use it to install the app they have already packaged into a temporary folder.

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'install-stable: %s\n' "$1" >&2
  exit 1
}

target="${1:-$HOME/Applications/worfy-stable.app}"
[ "$#" -le 1 ] || fail "expected at most one argument, the target .app path; got $#"
# Shell completion ends a folder path with a slash; drop it before the .app check.
target="${target%/}"
case "$target" in
  *.app) ;;
  *) fail "the target must be a path ending in .app, got: $target" ;;
esac
parent="$(dirname "$target")"
mkdir -p "$parent"
# Both spellings of the target: a process started through a symlinked folder (/var -> /private/var
# on macOS) shows the path it was started by.
logical="$(cd "$parent" && pwd)/$(basename "$target")"
physical="$(cd "$parent" && pwd -P)/$(basename "$target")"
metadata="${logical%.app}.json"

refuse_if_running() {
  local processes running
  # The process list is taken first and searched afterwards, so the search itself is not in it.
  processes="$(ps -axo pid=,command=)"
  running="$(grep -F -e "$logical/Contents/" -e "$physical/Contents/" <<<"$processes" || true)"
  if [ -n "$running" ]; then
    printf '%s\n' "$running" >&2
    fail "the stable copy at $logical is running. Quit it (stop Autopilot first, or wait for the gap between waves), then run this again."
  fi
}

# Before the build, so a refusal costs nothing; again before the copy, since the copy may have
# been started while the build ran.
refuse_if_running

if [ -n "${WORFY_STABLE_PREBUILT:-}" ]; then
  source_app="$WORFY_STABLE_PREBUILT"
  [ -d "$source_app" ] || fail "WORFY_STABLE_PREBUILT is not a folder: $source_app"
else
  (cd "$repo" && pnpm package)
  shopt -s nullglob
  built=("$repo"/dist/mac*/worfy.app)
  shopt -u nullglob
  [ "${#built[@]}" -eq 1 ] || fail "expected exactly one dist/mac*/worfy.app after the build, found ${#built[@]}"
  source_app="${built[0]}"
fi

commit="$(git -C "$repo" rev-parse HEAD)"
# Untracked files count: the build bundles a new source file whether git tracks it or not.
if [ -n "$(git -C "$repo" status --porcelain)" ]; then dirty=true; else dirty=false; fi
built_at="$(date -u -r "$(stat -f %m "$source_app/Contents/Info.plist")" +%Y-%m-%dT%H:%M:%SZ)"
installed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

refuse_if_running

# Copy next to the target first, then swap: an interrupted copy never leaves half an app at the
# target path. ditto keeps the bundle's signature, extended attributes and symlinks intact.
staging="$logical.installing-$$"
rm -rf "$staging"
trap 'rm -rf "$staging"' EXIT
ditto "$source_app" "$staging"
rm -rf "$logical"
mv "$staging" "$logical"
trap - EXIT

json_string() {
  local value="${1//\\/\\\\}"
  printf '"%s"' "${value//\"/\\\"}"
}

{
  printf '{\n'
  printf '  "commit": %s,\n' "$(json_string "$commit")"
  printf '  "dirty": %s,\n' "$dirty"
  printf '  "builtAt": %s,\n' "$(json_string "$built_at")"
  printf '  "installedAt": %s,\n' "$(json_string "$installed_at")"
  printf '  "source": %s\n' "$(json_string "$source_app")"
  printf '}\n'
} >"$metadata"

printf 'install-stable: installed %s (commit %s%s), details in %s\n' \
  "$logical" "${commit:0:7}" "$([ "$dirty" = true ] && printf ', uncommitted changes' || true)" "$metadata"
