#!/usr/bin/env bash
# Acceptance of a ticket over two repositories of one project, end to end, on the fixture fixtures/multi-repo: a
# library (lib) and the shop that uses it (app), each a git repository with a local bare origin, in one working
# folder above them; the project is in Silent mode with `parallel: single` and people merge (workflow.merge null), so
# the tickets live in that working folder and every repository is worked on in its own main checkout.
# The path the user sees:
#   1. one ticket file with two Repo: lines, the library first; one branch name in both checkouts;
#   2. one review verdict, its mark on the head of each branch;
#   3. a PR in each repository (the shop's a draft), `ticket pr` for both, `ticket release` for what the shop waits for;
#   4. `ticket done` with the PR of one repository only is refused;
#   5. epic-status names both PRs and "waits for release";
#   6. people merge the library, the team releases it (a tag on its origin and a published version), the release is
#      noticed the way the orchestrator notices it (git ls-remote, npm view), the shop's PR leaves draft, people merge
#      it, and `ticket done` with both PRs closes the ticket;
#   7. a ticket with one Repo: line in the same project works as it did before.
# gh and npm are the fixture's stubs (fixtures/multi-repo/bin): no call reaches GitHub or a registry. HOME and
# HARNESS_HOME are temporary folders, and the test checks that the real ~/.claude is unchanged.
# Run: bash harness/bin/tests/multi-repo.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$(cd "$HERE/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
TICKET="$BIN/ticket" STATUS="$BIN/epic-status" PROFILE="$BIN/profile"
FX="$HERE/fixtures/multi-repo"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HERE/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN GH_HOST GITHUB_ACTIONS
unset CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR CLAUDE_PROFILE_BIN
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-t}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-t@t}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-t}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-t@t}"
export HOME="$T/home" USERPROFILE="$T/home" HARNESS_HOME="$T/hh"
# Paths written into files node reads are in node's spelling: C:/… in Git Bash on Windows, the same as $T elsewhere.
TN="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
# slashes <path>: a path node prints, with / for \ — node on Windows prints D:\a\…, TN is D:/a/….
slashes() { printf '%s' "$1" | tr '\\' '/'; }
# jq without carriage returns: jq.exe on Windows ends its lines with CRLF. Git Bash drops the CR in $(…) but not in
# `read`, so a loop over jq's lines would get "41\r" for 41; the stub gh strips them the same way.
jq() { command jq "$@" | tr -d '\r'; return "${PIPESTATUS[0]}"; }

# --- the stubs: gh and npm of the fixture, first on PATH; the guards stop the test before a real one could run ------
STUBS="$T/stubs"
mkdir -p "$STUBS" "$T/gh-state"
cp "$FX/bin/gh" "$FX/bin/npm" "$STUBS/" && chmod +x "$STUBS/gh" "$STUBS/npm"
export PATH="$STUBS:$PATH"
export FIXTURE_GH_LOG="$T/gh.log" FIXTURE_GH_STATE="$T/gh-state" FIXTURE_NPM_LOG="$T/npm.log" FIXTURE_NPM_REGISTRY="$T/registry"
: >"$FIXTURE_GH_LOG"; : >"$FIXTURE_NPM_LOG"; : >"$FIXTURE_NPM_REGISTRY"
. "$HERE/gh-stand-in.sh"
refusing_gh_exe "$STUBS/gh"
gh_guard - "$STUBS/gh" -
if [ "$(command -v npm)" != "$STUBS/npm" ]; then
    echo "REFUSED: npm in PATH is $(command -v npm || echo missing), not the stub $STUBS/npm: the test would reach a registry" >&2
    exit 1
fi

# --- the project: two repositories under one working folder, their origins, the registry and the profile ----------
W="$T/work"
mkdir -p "$HOME" "$HARNESS_HOME/gate" "$HARNESS_HOME/projects/suite" "$T/origins" "$W/.scratch/lots/issues"
for r in lib app; do
    git init -q --bare -b main "$T/origins/$r.git"
    cp -R "$FX/$r" "$W/$r"
    git init -q -b main "$W/$r"
    git -C "$W/$r" add -A && git -C "$W/$r" commit -q -m "First version"
    git -C "$W/$r" remote add origin "$TN/origins/$r.git"
    git -C "$W/$r" push -q -u origin main 2>/dev/null
done
printf '{"repos":[{"key":"lib","match":"%s","profile":"suite"},{"key":"app","match":"%s","profile":"suite"}]}\n' "$TN/work/lib" "$TN/work/app" \
    >"$HARNESS_HOME/gate/config.json"
cat >"$HARNESS_HOME/projects/suite/profile.json" <<'EOF'
{"schema":2,"name":"suite","mode":"silent","parallel":"single",
 "tickets":{"root":".scratch/","done_section":"## Done when","manual_mark":"manual"},
 "workflow":{"finish":"pr-green-ci","merge":null}}
EOF
: >"$HARNESS_HOME/projects/suite/rules.md"
cp "$FX/issues/"*.md "$W/.scratch/lots/issues/"
T1="$W/.scratch/lots/issues/01-withdrawn-lots.md" T2="$W/.scratch/lots/issues/02-shop-title.md"
# The PR numbers GitHub would give next in each repository: they differ, as in a real project.
mkdir -p "$FIXTURE_GH_STATE/lib" "$FIXTURE_GH_STATE/app"
echo 41 >"$FIXTURE_GH_STATE/lib/next"
echo 118 >"$FIXTURE_GH_STATE/app/next"

# tk <args…>: ticket from the working folder; stdout and stderr go to $T/out, the exit code is returned.
tk() { (cd "$W" && node "$TICKET" "$@") >"$T/out" 2>&1; }
# es <args…>: epic-status from the working folder, stdout only.
es() { (cd "$W" && node "$STATUS" "$@") 2>"$T/err"; }
# hdr <file>: the header lines from Status to Blocked by, the times as T, joined by |.
hdr() { sed -n '/^Status:/,/^Blocked by:/p' "$1" | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z/T/' | tr '\n' '|'; }
# json_of <NN>: the object of that ticket in epic-status --json.
json_of() { es --json lots | jq -c --argjson n "$1" '.tickets[] | select(.num == $n)'; }
# path_of <repo>: the checkout of a repository, from the profile, as the orchestrator takes it.
path_of() { (cd "$W" && node "$PROFILE" --field _resolved.repos) | jq -r --arg r "$1" '.[] | select(.name == $r) | .path'; }
# pr_field <repo> <N> <field>: one field of a PR, through gh in that repository's checkout.
pr_field() { (cd "$(path_of "$1")" && gh pr view "$2" --json "$3" --jq ".$3"); }
# merged: "<merged>/<all> merged" over the PR lines of the ticket of two repositories, each asked of gh.
merged() {
    local all=0 n=0 repo num
    while read -r repo num; do
        all=$((all + 1))
        [ "$(pr_field "$repo" "$num" state)" = MERGED ] && n=$((n + 1))
    done < <(json_of 1 | jq -r '.prs[] | "\(.repo) \(.number)"')
    echo "$n/$all merged"
}
# release: "released" when every Release: line of the ticket is out, otherwise "waiting" — the checks of the
# orchestrator: a tag is on the library's origin, a package version is published (npm view in the consumer's checkout,
# the last Repo: line).
release() {
    local kind repo ref lib consumer seen=released
    consumer="$(path_of "$(json_of 1 | jq -r '.repos[-1]')")"
    while read -r kind repo ref; do
        lib="$(path_of "$repo")"
        case "$kind" in
        tag) git -C "$lib" ls-remote --tags origin "refs/tags/$ref" | cut -f2 | grep -qx "refs/tags/$ref" || seen=waiting ;;
        package) [ "$(cd "$consumer" && npm view "$ref" version)" = "${ref##*@}" ] || seen=waiting ;;
        *) seen="unknown kind $kind" ;;
        esac
    done < <(json_of 1 | jq -r '.releases[] | "\(.kind) \(.repo) \(.ref)"')
    echo "$seen"
}
# people_merge <repo> <N>: what people do on GitHub — the branch goes into main on the origin, the PR is MERGED.
people_merge() {
    local d="$W/$1" s="$FIXTURE_GH_STATE/$1/$2.json"
    git -C "$d" switch -q main && git -C "$d" merge -q --ff-only "$(jq -r .headRefName "$s")" && git -C "$d" push -q origin main 2>/dev/null \
        && jq '.state = "MERGED"' "$s" >"$s.new" && mv "$s.new" "$s"
}

# --- 0. the project as the Harness sees it ---------------------------------------------------------------------------
[ "$(cd "$W" && node "$PROFILE" --field _resolved.repos | jq -r '[.[].name] | join(",")')" = "lib,app" ] \
    && [ "$(cd "$W" && node "$PROFILE" --field _resolved.mode)" = silent ] \
    && ok "profile from the working folder: Silent mode, the repositories lib and app" || bad "profile: $(cd "$W" && node "$PROFILE" --field _resolved 2>&1 | head -c 400)"
[ "$(slashes "$(cd "$W" && node "$TICKET" root)")" = "$TN/work/.scratch" ] && ok "the tickets live in the working folder above the repositories" \
    || bad "tickets root: $(cd "$W" && node "$TICKET" root 2>&1)"

# --- 1. one ticket, two Repo: lines (the library first), one branch in both checkouts --------------------------------
BR=withdrawn-lots
for r in lib app; do git -C "$W/$r" switch -q -c "$BR"; done
cp "$T1" "$T/t1.before"
tk claim lots 01 --branch "$BR" --repo lib --repo web; rc=$?
[ "$rc" -ne 0 ] && grep -q '"web" is not a repository of the project (lib, app)' "$T/out" && cmp -s "$T/t1.before" "$T1" \
    && ok "claim --repo web: not a repository of the project -> refused, the file unchanged" || bad "claim web: exit $rc $(cat "$T/out")"
tk claim lots 01 --branch "$BR" --repo lib --repo app; rc=$?
[ "$rc" -eq 0 ] && [ "$(hdr "$T1")" = "Status: claimed T|Branch: $BR|Repo: lib|Repo: app|Blocked by: —|" ] \
    && ok "claim --repo lib --repo app: one Branch: line, Repo: lib before Repo: app" || bad "claim: exit $rc $(cat "$T/out") header $(hdr "$T1")"
line_branch="$(sed -n 's/^Branch: //p' "$T1")"
[ "$(git -C "$(path_of lib)" branch --show-current)" = "$line_branch" ] && [ "$(git -C "$(path_of app)" branch --show-current)" = "$line_branch" ] \
    && ok "the branch of the Branch: line is checked out in the main checkout of both repositories" || bad "branches: lib $(git -C "$W/lib" branch --show-current), app $(git -C "$W/app" branch --show-current)"

# The change: the library adds isWithdrawn and keeps isOpen as it was (each PR is safe on its own), its version goes
# to 1.4.0; the shop raises its range to ^1.4.0 and uses the new function.
printf '%s\n' '' '// A withdrawn lot stays in the list but cannot be bid on.' 'export const isWithdrawn = (lot) => lot.withdrawn === true' >>"$W/lib/index.mjs"
jq '.version = "1.4.0"' "$W/lib/package.json" >"$T/p" && mv "$T/p" "$W/lib/package.json"
git -C "$W/lib" commit -q -am "Withdrawn lots"
printf '%s\n' '// The shop of the fixture: the lots that can be bid on.' 'import { isOpen, isWithdrawn } from "@acme/lots"' '' \
    'export const biddable = (lots) => lots.filter((lot) => isOpen(lot) && !isWithdrawn(lot))' >"$W/app/index.mjs"
jq '.dependencies["@acme/lots"] = "^1.4.0"' "$W/app/package.json" >"$T/p" && mv "$T/p" "$W/app/package.json"
git -C "$W/app" commit -q -am "Hide withdrawn lots"
LIB_HEAD="$(git -C "$W/lib" rev-parse HEAD)" APP_HEAD="$(git -C "$W/app" rev-parse HEAD)"

# --- 2. one review verdict on the heads of both branches: a mark on each head, in the marks file of Silent mode ----
tk mark lots 01 review success --sha "$LIB_HEAD"; rc1=$?
tk mark lots 01 review success --sha "$APP_HEAD"; rc2=$?
MARKS="$HARNESS_HOME/runs/suite/marks/lots-01.json"
[ "$rc1$rc2" = 00 ] && [ "$(jq -r '[.marks[] | .kind + "=" + .verdict + "@" + .sha] | join(" ")' "$MARKS" 2>/dev/null)" = "review=success@$LIB_HEAD review=success@$APP_HEAD" ] \
    && [ ! -s "$FIXTURE_GH_LOG" ] && ok "review success marked on the head of lib and of app, in the marks file; no gh call" \
    || bad "marks: exit $rc1 $rc2, $(cat "$MARKS" 2>/dev/null) gh: $(cat "$FIXTURE_GH_LOG")"

# --- 3. the PRs, opened together: the library's ready, the shop's a draft until the release ---------------------------
for r in lib app; do git -C "$W/$r" push -q -u origin "$BR" 2>/dev/null; done
LIB_URL="$(cd "$W/lib" && gh pr create --head "$BR" --title "Withdrawn lots" --body "Adds isWithdrawn; isOpen is unchanged.")"
APP_URL="$(cd "$W/app" && gh pr create --draft --head "$BR" --title "Hide withdrawn lots" --body "Lists only lots that can be bid on.")"
LIB_PR="${LIB_URL##*/}" APP_PR="${APP_URL##*/}"
[ "$LIB_PR" = 41 ] && [ "$APP_PR" = 118 ] && [ "$(pr_field app 118 isDraft)" = true ] && [ "$(pr_field lib 41 isDraft)" = false ] \
    && ok "gh (stub): lib#41 opened, app#118 opened as a draft" || bad "PRs: $LIB_URL $APP_URL"
tk pr lots 01 "lib#$LIB_PR"; rc=$?
[ "$rc" -eq 0 ] && grep -qx 'PR: lib#41' "$T1" && ok "ticket pr lots 01 lib#41 writes PR: lib#41" || bad "pr lib: exit $rc $(cat "$T/out")"

# --- 4. done with the PR of one repository only: refused, nothing written ---------------------------------------------
cp "$T1" "$T/t1.one"
tk done lots 01; rc=$?
[ "$rc" -eq 2 ] && grep -q "no PR of app (Repo: lib, app)" "$T/out" && cmp -s "$T/t1.one" "$T1" \
    && ok "done with PR lib#41 only -> exit 2 naming app, the file unchanged" || bad "done one PR: exit $rc $(cat "$T/out")"
tk done lots 01 --pr "lib#$LIB_PR"; rc=$?
[ "$rc" -eq 2 ] && grep -q "no PR of app" "$T/out" && cmp -s "$T/t1.one" "$T1" \
    && ok "done --pr lib#41 -> exit 2, the file unchanged" || bad "done --pr lib only: exit $rc $(cat "$T/out")"
tk done lots 01 --pr "$APP_PR"; rc=$?
[ "$rc" -eq 2 ] && cmp -s "$T/t1.one" "$T1" && ok "done --pr 118 (a bare number on a ticket of two repositories) -> exit 2" || bad "done bare: exit $rc $(cat "$T/out")"

tk pr lots 01 "app#$APP_PR"; rc=$?
[ "$rc" -eq 0 ] && ok "ticket pr lots 01 app#118 -> exit 0" || bad "pr app: exit $rc $(cat "$T/out")"
LIB_PKG="$(jq -r '.name + "@" + .version' "$W/lib/package.json")"
tk release lots 01 lib tag lib-v1.4.0; rc1=$?
tk release lots 01 lib package "$LIB_PKG"; rc2=$?
[ "$rc1$rc2" = 00 ] && [ "$(hdr "$T1")" = "Status: claimed T|PR: lib#41|PR: app#118|Release: lib tag lib-v1.4.0|Release: lib package @acme/lots@1.4.0|Branch: $BR|Repo: lib|Repo: app|Blocked by: —|" ] \
    && ok "the header: PR: lib#41, PR: app#118, Release: lines for the tag and the package, one Branch:, Repo: lib, Repo: app" \
    || bad "header after pr and release: exit $rc1 $rc2 $(hdr "$T1")"

# --- 5. epic-status: both PRs and the release the shop waits for ------------------------------------------------------
line="$(es lots)"; rc=$?
[ "$rc" -eq 0 ] && [[ "$line" == "/implement · lots 0/2 · "* ]] && [[ "$line" == *" · PR lib#41, app#118 · waits for release lib-v1.4.0, @acme/lots@1.4.0"* ]] \
    && ok "epic-status lots: one line, PR lib#41, app#118 · waits for release lib-v1.4.0, @acme/lots@1.4.0" || bad "epic-status: exit $rc [$line] $(cat "$T/err")"
j="$(json_of 1)"
[ "$(printf '%s' "$j" | jq -c '[.state, .branch, .repos, [.prs[] | "\(.repo)#\(.number)"], [.releases[] | "\(.repo) \(.kind) \(.ref)"]]')" \
    = "[\"work\",\"$BR\",[\"lib\",\"app\"],[\"lib#41\",\"app#118\"],[\"lib tag lib-v1.4.0\",\"lib package @acme/lots@1.4.0\"]]" ] \
    && ok "epic-status --json: claimed, one branch, repos [lib, app], prs and releases in file order" || bad "epic-status --json: $j"

# --- 6. merges by people, the release by the team, noticed by the orchestrator, done -----------------------------
[ "$(merged)" = "0/2 merged" ] && [ "$(release)" = waiting ] && ok "before any merge: 0/2 merged, the release is waited for" \
    || bad "before: $(merged), $(release)"
people_merge lib "$LIB_PR"
[ "$(merged)" = "1/2 merged" ] && [ "$(json_of 1 | jq -r .state)" = work ] && [ "$(pr_field app "$APP_PR" isDraft)" = true ] \
    && ok "the library merged: 1/2 merged, the ticket stays claimed, the shop's PR is still a draft" || bad "1/2: $(merged), $(json_of 1 | jq -r .state)"
[ "$(release)" = waiting ] && ok "a merge is not a release: the tag is not on the origin, the version is not published" || bad "release after merge: $(release)"
git -C "$W/lib" tag lib-v1.4.0 && git -C "$W/lib" push -q origin lib-v1.4.0 2>/dev/null
[ "$(release)" = waiting ] && ok "the tag is on the library's origin, the package not yet published: still waiting" || bad "tag only: $(release)"
echo "$LIB_PKG" >>"$FIXTURE_NPM_REGISTRY"
[ "$(release)" = released ] && ok "the tag on the origin (git ls-remote) and the version published (npm view): released" || bad "release: $(release)"
(cd "$(path_of app)" && gh pr ready "$APP_PR") && [ "$(pr_field app "$APP_PR" isDraft)" = false ] \
    && ok "after the release the shop's PR leaves draft (gh pr ready 118 in its checkout)" || bad "ready: $(pr_field app "$APP_PR" isDraft)"
people_merge app "$APP_PR"
[ "$(merged)" = "2/2 merged" ] && ok "the shop merged: 2/2 merged" || bad "2/2: $(merged)"
tk done lots 01 --pr "lib#$LIB_PR" --pr "app#$APP_PR"; rc=$?
[ "$rc" -eq 0 ] && [ "$(hdr "$T1")" = "Status: done T|PR: lib#41|PR: app#118|Release: lib tag lib-v1.4.0|Release: lib package @acme/lots@1.4.0|Branch: $BR|Repo: lib|Repo: app|Blocked by: —|" ] \
    && ok "done --pr lib#41 --pr app#118 with both merged and the release out: Status done, every line kept" || bad "done: exit $rc $(cat "$T/out") $(hdr "$T1")"
[ "$(json_of 1 | jq -r .state)" = done ] && [[ "$(es lots)" == "/implement · lots 1/2 · "* ]] && ok "epic-status counts the ticket of two repositories once: lots 1/2" \
    || bad "epic-status after done: $(es lots)"

# --- 7. a ticket with one Repo: line in the same project: as before -------------------------------------------------
git -C "$W/app" switch -q -c shop-title
tk claim lots 02 --branch shop-title --repo app; rc=$?
[ "$rc" -eq 0 ] && [ "$(hdr "$T2")" = "Status: claimed T|Branch: shop-title|Repo: app|Blocked by: —|" ] \
    && ok "one Repo: line: claim --repo app --branch shop-title writes what it did before" || bad "one repo claim: exit $rc $(cat "$T/out") $(hdr "$T2")"
jq '.description = "The shop of the fixture"' "$W/app/package.json" >"$T/p" && mv "$T/p" "$W/app/package.json"
git -C "$W/app" commit -q -am "Describe the shop" && git -C "$W/app" push -q -u origin shop-title 2>/dev/null
ONE_URL="$(cd "$W/app" && gh pr create --head shop-title --title "Describe the shop" --body "A description.")"; ONE_PR="${ONE_URL##*/}"
cp "$T2" "$T/t2.before"
tk pr lots 02 "app#$ONE_PR"; rc=$?
[ "$rc" -eq 2 ] && cmp -s "$T/t2.before" "$T2" && ok "one Repo: line: pr app#119 -> exit 2, a ticket of one repository writes PR: #N" || bad "one repo pr app#: exit $rc $(cat "$T/out")"
tk pr lots 02 "#$ONE_PR"; rc=$?
[ "$rc" -eq 0 ] && grep -qx "PR: #$ONE_PR" "$T2" && ok "one Repo: line: pr #119 writes PR: #119" || bad "one repo pr: exit $rc $(cat "$T/out")"
j2="$(json_of 2)"
[ "$(printf '%s' "$j2" | jq -c '[.repo, .pr, has("repos"), has("prs"), has("releases")]')" = "[\"app\",$ONE_PR,false,false,false]" ] \
    && [[ "$(es lots)" != *"waits for release"* ]] && ok "one Repo: line: epic-status --json has repo and pr, no repos, prs or releases; no release in the line" \
    || bad "one repo json: $j2 [$(es lots)]"
people_merge app "$ONE_PR"
tk done lots 02 --pr "$ONE_PR"; rc=$?
[ "$rc" -eq 0 ] && [ "$(hdr "$T2")" = "Status: done T|PR: #$ONE_PR|Branch: shop-title|Repo: app|Blocked by: —|" ] \
    && ok "one Repo: line: done --pr 119 -> Status done, PR: #119" || bad "one repo done: exit $rc $(cat "$T/out") $(hdr "$T2")"
[[ "$(es lots)" == "closed · lots 2/2"* ]] && ok "epic-status: closed · lots 2/2" || bad "closed: $(es lots)"

# --- what the run left behind ---------------------------------------------------------------------------------------------
for r in lib app; do
    [ -z "$(git -C "$W/$r" status --porcelain)" ] && [ ! -e "$W/$r/.scratch" ] && ok "Silent mode: nothing of the workflow in the $r repository" \
        || bad "$r has: $(git -C "$W/$r" status --porcelain) $(ls -a "$W/$r")"
done
[ "$(cut -d' ' -f2-3 "$FIXTURE_GH_LOG" | sort -u | tr '\n' ',')" = "pr create,pr ready,pr view," ] \
    && ok "gh was asked only to create, view and ready PRs; never to merge" || bad "gh calls: $(cat "$FIXTURE_GH_LOG")"
[ -s "$FIXTURE_NPM_LOG" ] && [ "$(cut -d' ' -f2 "$FIXTURE_NPM_LOG" | sort -u)" = view ] && ok "npm was asked only npm view" || bad "npm calls: $(cat "$FIXTURE_NPM_LOG")"

home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
