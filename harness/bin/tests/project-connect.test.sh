#!/usr/bin/env bash
# Tests of harness/bin/project-connect. Run: bash harness/bin/tests/project-connect.test.sh; exit 0 —
# everything passed.
#
# Sandbox only: HOME, HARNESS_HOME and CLAUDE_CONFIG_DIR point into a temporary directory, and the
# real ~/.claude (the Harness parts) is compared before and after (real-home.sh). Checked: a draft
# goes to projects/<name>/ and the gate registry, and bin/profile then knows the repository; Silent
# mode's default Workflow folder is created with git; --check and --schema-only write nothing;
# a taken name, a registered `match`, Full mode over two repositories and a broken draft are exit 1
# with nothing changed; a failure half-way is rolled back; one commit in the git of HARNESS_HOME;
# the qmd step runs only with qmd and its models, after the commit; the project's repository stays
# clean — a Silent project gets `.claude/worktrees/` in .git/info/exclude, once, and nothing else;
# --facts reads remotes and branches of a repository and of a folder above several, and writes nothing.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
CONNECT="$BIN/project-connect"
PROFILE="$BIN/profile"
pass=0
fail=0
. "$(dirname "$0")/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME")"

T="$(mktemp -d)"
. "$(dirname "$0")/gh-stand-in.sh" # node_path, on_windows, node_stand_in
# node_path: C:/… in Git Bash on Windows, the spelling git prints and node reads; the registry's "match" must be
# in that spelling, or bin/profile does not find the repository (/tmp/… is C:\tmp\… to node). Elsewhere: pwd -P.
T="$(cd "$T" && node_path "$(pwd -P)")"
# A path as bin/profile and project-connect print it: with backslashes on Windows (cygpath exists there),
# unchanged elsewhere.
printed() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
# The same path inside a JSON string, as project-connect prints it: each backslash doubled.
jpath() { local p; p="$(printed "$1")"; printf '%s' "${p//\\/\\\\}"; }
trap 'rm -rf "$T"' EXIT
# The gate exports its own registry to the tests it runs; this test has its own.
unset CLAUDE_GATE_CONFIG CLAUDE_GATE_RESOLVE CLAUDE_GATE_STATE CLAUDE_PROFILES_DIR PROJECT_CONNECT_FAIL_AT PROJECT_CONNECT_QMD_BIN
# USERPROFILE: node's os.homedir() on Windows, where bin/profile and project-connect look for the old registry.
export HOME="$T/home" USERPROFILE="$T/home"
export HARNESS_HOME="$T/home/.claude/worfy-harness"
export CLAUDE_CONFIG_DIR="$T/home/.claude"
mkdir -p "$HOME" "$T/bin"
# No qmd on the PATH unless a case puts its own stub first.
export PROJECT_CONNECT_QMD="$T/bin/no-qmd"
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Harness Test}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-harness-test@example.invalid}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Harness Test}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-harness-test@example.invalid}"

ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# check <name> <expected exit> <expected stdout substring or ""> <command…>
check() {
    local name="$1" want_rc="$2" want_out="$3"
    shift 3
    local got rc
    got="$("$@" 2>"$T/err")"
    rc=$?
    if [ "$rc" -eq "$want_rc" ] && { [ -z "$want_out" ] || [[ "$got" == *"$want_out"* ]]; }; then ok "$name (exit $rc)"
    else bad "$name: exit $rc (want $want_rc); stdout: ${got:0:300}; stderr: $(head -c 300 "$T/err")"; fi
}

repo() { # $1 path — a git repository with one commit
    mkdir -p "$1"
    git -C "$1" init -q -b main
    printf '{"name":"x","scripts":{"lint":"eslint .","test":"vitest run"}}\n' >"$1/package.json"
    git -C "$1" add package.json
    git -C "$1" commit -q -m init
}

# draft <name> <mode> <folder JSON> <match>… — a draft as skill connect-project proposes it
# (`attribution` off in Silent mode, on in Full mode).
draft() {
    local name="$1" mode="$2" folder="$3"
    shift 3
    node - "$name" "$mode" "$folder" "$@" <<'NODE'
const [name, mode, folder, ...matches] = process.argv.slice(2)
const profile = {
  schema: 2, name, title: name, mode,
  language: { reports: "en", team: "en", docs: "en" }, attribution: mode === "silent" ? "off" : "on",
  layout: { summary: "one package", packages: ["."], repos: null }, stack: ["node"],
  commands: { install: "npm ci", lint: "npm run lint", typecheck: null, test: "npm test", test_one: null, contract: null, e2e: null,
              build: null, verify: "npm run lint && npm test", prepare_tree: "npm ci", requires: [] },
  parallel: "worktrees",
  worktree: { root: matches[0] + "/.claude/worktrees/", base: "origin/main", implementer: null, reviewer: null },
  tickets: { root: ".scratch/", path: ".scratch/<epic>/issues/NN-*.md", trail_section: "## Where in the code", spec: ".scratch/<epic>/spec.md", branch: null },
  workflow: { folder: JSON.parse(folder), ticket_skill: "ship-ticket", implementer_steps: "steps 1-8", finish: "local-green", merge: "orchestrator" },
  numbering: null, deploy: null, github: { account: null }, docs: null, lessons: "repo:docs/lessons",
  mcp: { allowed: ["plugin_worfy_qmd", "worfy-canvas"] }, review: { lenses: ["correctness"], ticket_lenses: ["correctness"] },
}
const gate = matches.map((match) => ({ key: require("path").basename(match), match, profile: name, pm: "npm", root: { fast: ["lint", "test"], full: ["lint", "test"] }, workspace: {} }))
process.stdout.write(JSON.stringify({ profile, rules: "# " + name + "\n\n## Sources\n\n- package.json\n", gate }))
NODE
}

state() { # the files of HARNESS_HOME (without .git) with their contents' hash, and its HEAD
    (cd "$HARNESS_HOME" 2>/dev/null && find . -path ./.git -prune -o -type f -print | sort | while read -r f; do printf '%s %s\n' "$f" "$(shasum "$f" | cut -c1-12)"; done
     git -C "$HARNESS_HOME" rev-parse -q --verify HEAD 2>/dev/null)
}
commits() { git -C "$HARNESS_HOME" rev-list --count HEAD 2>/dev/null || echo 0; }

# --- a Harness home that is a git repository with one commit, and a registry with another project ---
mkdir -p "$HARNESS_HOME/gate" "$HARNESS_HOME/projects/other"
repo "$T/other"
printf '{"repos":[{"key":"other","match":"%s","profile":"other","pm":"npm","root":{},"workspace":{}}]}\n' "$T/other" >"$HARNESS_HOME/gate/config.json"
printf '{"schema":2,"name":"other","mode":"full"}\n' >"$HARNESS_HOME/projects/other/profile.json"
printf '*/state/\n' >"$HARNESS_HOME/.gitignore"
git -C "$HARNESS_HOME" init -q
git -C "$HARNESS_HOME" add -A
git -C "$HARNESS_HOME" commit -q -m base

# --- --facts: only reads -------------------------------------------------------------------
repo "$T/f-remote"
git -C "$T/f-remote" remote add origin "https://someone:s3cret@example.com/acme/shop.git"
git -C "$T/f-remote" remote add upstream "git@example.com:acme/shop.git"
check "--facts of a repository: kind git" 0 '"kind": "git"' "$CONNECT" --facts "$T/f-remote"
check "--facts names origin without the credentials" 0 '"origin": "https://example.com/acme/shop.git"' "$CONNECT" --facts "$T/f-remote"
check "--facts never prints the password" 1 "" bash -c '"$1" --facts "$2" | grep -q s3cret' _ "$CONNECT" "$T/f-remote"
check "--facts lists every remote" 0 '"name": "upstream"' "$CONNECT" --facts "$T/f-remote"
check "--facts: the default branch without origin/HEAD is the local main" 0 '"defaultBranch": "main"' "$CONNECT" --facts "$T/f-remote"
git -C "$T/f-remote" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk
check "--facts: the default branch follows origin/HEAD" 0 '"defaultBranch": "trunk"' "$CONNECT" --facts "$T/f-remote"
mkdir -p "$T/f-remote/src"
check "--facts of a subfolder answers for the repository root" 0 "\"folder\": \"$(jpath "$T/f-remote")\"" "$CONNECT" --facts "$T/f-remote/src"
repo "$T/f-plain"
check "--facts of a repository without remotes: none, origin null" 0 '"remotes": [],' "$CONNECT" --facts "$T/f-plain"
check "--facts of a repository without remotes: origin null" 0 '"origin": null' "$CONNECT" --facts "$T/f-plain"
mkdir -p "$T/f-ws"
repo "$T/f-ws/api"
repo "$T/f-ws/web"
mkdir -p "$T/f-ws/notes"
check "--facts of a folder above two repositories: multi-repo" 0 '"kind": "multi-repo"' "$CONNECT" --facts "$T/f-ws"
check "--facts lists both repositories" 0 "$(jpath "$T/f-ws/web")" "$CONNECT" --facts "$T/f-ws"
mkdir -p "$T/f-none/docs"
check "--facts of a folder without repositories is exit 1" 1 "holds no repositories" "$CONNECT" --facts "$T/f-none"
check "--facts without a folder is exit 2" 2 "" "$CONNECT" --facts
for r in f-remote f-plain f-ws/api f-ws/web; do
    [ -z "$(git -C "$T/$r" status --porcelain --ignored --untracked-files=all)" ] && ok "--facts left $r clean" || bad "--facts changed $r"
done

# --- Silent mode with the default Workflow folder ---------------------------------
repo "$T/shop"
draft shop silent null "$T/shop" >"$T/shop.json"
before="$(state)"
check "--schema-only passes a draft by the schema" 0 '"ok": true' "$CONNECT" --schema-only <"$T/shop.json"
check "--check passes and names the default Workflow folder" 0 "$(jpath "$HARNESS_HOME/projects/shop/workflow")" "$CONNECT" --check <"$T/shop.json"
[ "$before" = "$(state)" ] && ok "--check and --schema-only write nothing" || bad "--check and --schema-only wrote into HARNESS_HOME"
n0="$(commits)"
check "a Silent draft is written" 0 '"profileDir": "'"$(jpath "$HARNESS_HOME/projects/shop")"'"' bash -c 'set -o pipefail; "$1" <"$2" | tee "$3"' _ "$CONNECT" "$T/shop.json" "$T/shop.out"
[ -f "$HARNESS_HOME/projects/shop/profile.json" ] && [ -f "$HARNESS_HOME/projects/shop/rules.md" ] && ok "profile.json and rules.md in projects/shop/" || bad "projects/shop/ is incomplete"
check "the gate registry keeps the other project and adds shop" 0 "other shop" \
    node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).repos; process.stdout.write(r.map(e=>e.key).join(" "))' "$HARNESS_HOME/gate/config.json"
check "bin/profile -C <repository> --field mode prints silent" 0 "silent" "$PROFILE" -C "$T/shop" --field mode
check "bin/profile -C <repository> --name" 0 "shop" "$PROFILE" -C "$T/shop" --name
[ "$(jq -r .attribution "$HARNESS_HOME/projects/shop/profile.json")" = off ] && [ "$("$PROFILE" -C "$T/shop" --field attribution)" = off ] \
    && ok "a Silent draft is written with attribution off, and bin/profile prints off" || bad "Silent attribution: $(jq -c .attribution "$HARNESS_HOME/projects/shop/profile.json")"
check "the written workflow.folder is the default folder" 0 "$(printed "$HARNESS_HOME/projects/shop/workflow")" "$PROFILE" -C "$T/shop" --field workflow.folder
[ -d "$HARNESS_HOME/projects/shop/workflow/.git" ] && ok "the default Workflow folder is created with git" || bad "no $HARNESS_HOME/projects/shop/workflow/.git"
[ "$(commits)" -eq $((n0 + 1)) ] && ok "exactly one new commit in the git of HARNESS_HOME" || bad "commits: $n0 -> $(commits)"
check "the commit holds the profile, rules.md and the registry" 0 "gate/config.json" git -C "$HARNESS_HOME" show --name-only --format= HEAD
check "the Harness home's history leaves the Workflow folder out" 0 "/projects/*/workflow/" cat "$HARNESS_HOME/.gitignore"
[ -z "$(git -C "$HARNESS_HOME" status --porcelain)" ] && ok "HARNESS_HOME has nothing left uncommitted" || bad "HARNESS_HOME is dirty: $(git -C "$HARNESS_HOME" status --porcelain)"
[ -z "$(git -C "$T/shop" status --porcelain --ignored --untracked-files=all)" ] && ok "the project's repository is untouched" || bad "the repository changed: $(git -C "$T/shop" status --porcelain --ignored --untracked-files=all)"
[ "$(grep -cx '.claude/worktrees/' "$T/shop/.git/info/exclude")" = 1 ] && ok "Silent: .claude/worktrees/ is in .git/info/exclude once" || bad "exclude of shop: $(cat "$T/shop/.git/info/exclude")"
check "the output names the exclude file" 0 "$(jpath "$T/shop/.git/info/exclude")" cat "$T/shop.out"
mkdir -p "$T/shop/.claude/worktrees/05/src"
echo x >"$T/shop/.claude/worktrees/05/src/a.ts"
[ -z "$(git -C "$T/shop" status --porcelain --untracked-files=all)" ] && ok "a ticket worktree folder does not show in git status" || bad "git status shows: $(git -C "$T/shop" status --porcelain --untracked-files=all)"
check "it is ignored by .git/info/exclude, not by a tracked file" 0 ".git/info/exclude" git -C "$T/shop" check-ignore -v .claude/worktrees/05/src/a.ts
rm -rf "$T/shop/.claude"
[ -z "$(git -C "$T/shop" ls-files --others --exclude-standard)" ] && [ ! -e "$T/shop/.gitignore" ] && ok "no .gitignore and no tracked file was written" || bad "a file appeared in shop"

check "the qmd step is skipped without qmd, with the reason" 0 "qmd is not installed" cat "$T/shop.out"

# --- refusals: nothing changes -------------------------------------------------------
before="$(state)"
check "a taken name is exit 1" 1 "the name is taken" "$CONNECT" <"$T/shop.json"
repo "$T/shop2"
draft shop2 full null "$T/other" >"$T/registered.json"
check "a match already in the registry is exit 1" 1 "is already in the gate registry" "$CONNECT" <"$T/registered.json"
check "--check refuses a registered match too" 1 "is already in the gate registry" "$CONNECT" --check <"$T/registered.json"
mkdir -p "$T/ws"
repo "$T/ws/api"
repo "$T/ws/web"
draft ws full null "$T/ws/api" "$T/ws/web" >"$T/ws-full.json"
check "Full mode over two repositories is exit 1" 1 "always in Silent mode" "$CONNECT" <"$T/ws-full.json"
draft shop2 silent null "$T/shop2" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); delete d.profile.mode; d.extra=1; process.stdout.write(JSON.stringify(d))' >"$T/broken.json"
check "a draft off the schema is exit 1, every reason named" 1 '"path": "profile.mode"' "$CONNECT" <"$T/broken.json"
check "a field outside the schema is named" 1 '"path": "extra"' "$CONNECT" --schema-only <"$T/broken.json"
# The names of the document sections: a blank one would make every later profile call warn and fall back.
for f in tickets.done_section tickets.manual_mark docs.adr_status_label; do
    jq --arg f "$f" '.profile |= setpath($f | split("."); "")' "$T/shop.json" >"$T/blank.json"
    check "a blank $f is refused by the schema" 1 "\"path\": \"profile.$f\"" "$CONNECT" --schema-only <"$T/blank.json"
done
jq '.profile.tickets.done_section = "## Done when" | .profile.tickets.manual_mark = null | .profile.docs = {adr_status_label: "Status"}' "$T/shop.json" >"$T/named.json"
check "the names of the document sections pass the schema" 0 '"ok": true' "$CONNECT" --schema-only <"$T/named.json"
check "a draft that is not JSON is exit 1" 1 "is not JSON" bash -c 'echo "{" | "$1"' _ "$CONNECT"
draft shop2 full '"/tmp"' "$T/shop2" >"$T/full-folder.json"
check "Full mode with a Workflow folder is exit 1" 1 "Full mode has no Workflow folder" "$CONNECT" --check <"$T/full-folder.json"
draft shop2 silent "\"$T/shop2/notes\"" "$T/shop2" >"$T/inside.json"
mkdir -p "$T/shop2/notes"
check "a Workflow folder inside the repository is exit 1" 1 "outside the project's repositories" "$CONNECT" --check <"$T/inside.json"
rmdir "$T/shop2/notes"
check "an unknown flag is exit 2" 2 "" "$CONNECT" --force <"$T/shop.json"
[ "$before" = "$(state)" ] && ok "the refusals changed nothing in HARNESS_HOME" || bad "a refusal changed HARNESS_HOME"

# --- a failure half-way is rolled back -------------------------------------------------
draft shop2 silent null "$T/shop2" >"$T/shop2.json"
for at in workflow gate exclude commit; do
    before="$(state)"
    exclude_before="$(cat "$T/shop2/.git/info/exclude")"
    check "a failure at the step $at is exit 1" 1 "rolled back" env PROJECT_CONNECT_FAIL_AT="$at" "$CONNECT" <"$T/shop2.json"
    [ "$before" = "$(state)" ] && [ ! -e "$HARNESS_HOME/projects/shop2" ] && ok "the failure at $at left nothing behind" || bad "the failure at $at left changes: $(diff <(echo "$before") <(state))"
    [ "$exclude_before" = "$(cat "$T/shop2/.git/info/exclude")" ] && ok "the failure at $at left .git/info/exclude as it was" || bad "the failure at $at changed the exclude file"
done

# --- .git/info/exclude: once, the common git dir of a linked worktree, not in Full mode --------
repo "$T/x-seeded"
printf '# mine\n.claude/worktrees/\n' >>"$T/x-seeded/.git/info/exclude"
seeded="$(cat "$T/x-seeded/.git/info/exclude")"
draft xseeded silent null "$T/x-seeded" >"$T/x-seeded.json"
check "a repository that excludes the folder already is connected" 0 '"excludes": []' "$CONNECT" <"$T/x-seeded.json"
[ "$seeded" = "$(cat "$T/x-seeded/.git/info/exclude")" ] && ok "no second .claude/worktrees/ line" || bad "exclude of x-seeded changed: $(cat "$T/x-seeded/.git/info/exclude")"
repo "$T/x-main"
git -C "$T/x-main" worktree add -q -b side "$T/x-linked"
draft xlinked silent null "$T/x-linked" >"$T/x-linked.json"
check "a linked worktree as the match is connected" 0 "$(jpath "$T/x-main/.git/info/exclude")" "$CONNECT" <"$T/x-linked.json"
[ "$(grep -cx '.claude/worktrees/' "$T/x-main/.git/info/exclude")" = 1 ] && ok "the line went into the common git dir" || bad "common exclude: $(cat "$T/x-main/.git/info/exclude")"
mkdir -p "$T/x-linked/.claude/worktrees/07"
echo x >"$T/x-linked/.claude/worktrees/07/f"
[ -z "$(git -C "$T/x-linked" status --porcelain --untracked-files=all)" ] && ok "the linked worktree does not show its ticket worktrees" || bad "linked status: $(git -C "$T/x-linked" status --porcelain --untracked-files=all)"
rm -rf "$T/x-linked/.claude"
repo "$T/x-full"
full_before="$(cat "$T/x-full/.git/info/exclude")"
draft xfull full null "$T/x-full" >"$T/x-full.json"
check "a Full project is connected" 0 '"excludes": []' "$CONNECT" <"$T/x-full.json"
[ "$full_before" = "$(cat "$T/x-full/.git/info/exclude")" ] && ok "Full mode leaves .git/info/exclude alone" || bad "Full mode changed exclude"

# --- attribution: the draft's value is written as it is; the skill proposes it by the mode -----
[ "$(jq -r .attribution "$HARNESS_HOME/projects/xfull/profile.json")" = on ] && [ "$("$PROFILE" -C "$T/x-full" --field attribution)" = on ] \
    && ok "a Full draft is written with attribution on, and bin/profile prints on" || bad "Full attribution: $(jq -c .attribution "$HARNESS_HOME/projects/xfull/profile.json")"
# The person chose `on` for a Silent project (and `off` for a Full one) in the form: the choice is written, not the default.
repo "$T/a-son"
draft ason silent null "$T/a-son" | jq -c '.profile.attribution = "on"' >"$T/a-son.json"
check "a Silent draft with attribution on is connected" 0 '"profileDir"' "$CONNECT" <"$T/a-son.json"
[ "$(jq -r .attribution "$HARNESS_HOME/projects/ason/profile.json")" = on ] && [ "$("$PROFILE" -C "$T/a-son" --field attribution)" = on ] \
    && ok "attribution on chosen for a Silent project is written as chosen" || bad "Silent with on: $(jq -c .attribution "$HARNESS_HOME/projects/ason/profile.json")"
repo "$T/a-foff"
draft afoff full null "$T/a-foff" | jq -c '.profile.attribution = "off"' >"$T/a-foff.json"
check "a Full draft with attribution off is connected" 0 '"profileDir"' "$CONNECT" <"$T/a-foff.json"
[ "$(jq -r .attribution "$HARNESS_HOME/projects/afoff/profile.json")" = off ] && [ "$("$PROFILE" -C "$T/a-foff" --field attribution)" = off ] \
    && ok "attribution off chosen for a Full project is written as chosen" || bad "Full with off: $(jq -c .attribution "$HARNESS_HOME/projects/afoff/profile.json")"
# The draft always names the value (the schema requires it), so the proposal is the skill's text.
SKILL="$HARNESS/skills/connect-project/SKILL.md"
rule="$(grep -A2 '^- `attribution` — ' "$SKILL" | tr '\n' ' ')"
[[ "$rule" == *'`attribution` — `"off"` in Silent mode, `"on"` in Full mode'* ]] && ok "skill connect-project proposes attribution off in Silent mode and on in Full mode" \
    || bad "skill connect-project, the attribution rule: [$rule]"
[ "$(grep -c '`attribution` — ' "$SKILL")" = 1 ] && ok "skill connect-project names the attribution value once" || bad "attribution rules in the skill: $(grep -c '`attribution` — ' "$SKILL")"
# What worfy does with the value belongs to the part for worfy: a terminal run has no worfy and no form, and
# bin/project-connect writes the draft as it is, so the rule above must not lean on worfy there.
worfy_part="$(sed -n '/^## With `--draft-only`/,/^## Without `--draft-only`/p' "$SKILL" | tr '\n' ' ')"
[[ "$worfy_part" == *'worfy sets `attribution` to `"off"` itself'* ]] && [ "$(grep -c 'worfy sets `attribution`' "$SKILL")" = 1 ] && [[ "$rule" != *"worfy"* ]] \
    && ok "skill connect-project says that worfy sets off only in its --draft-only part" || bad "skill connect-project, worfy's part: [$worfy_part] rule: [$rule]"
check "the draft schema requires attribution" 0 "" jq -e '.properties.profile.required | index("attribution")' "$HARNESS/profiles/draft.schema.json"

# --- a project over two repositories: Silent, the folder above them is the Workflow folder ---
draft ws silent "\"$T/ws\"" "$T/ws/api" "$T/ws/web" >"$T/ws.json"
check "a Silent project over two repositories is written" 0 '"gateKeys": [' "$CONNECT" <"$T/ws.json"
check "both repositories have the profile ws" 0 "ws" "$PROFILE" -C "$T/ws/web" --name
check "the folder above them resolves as the workspace" 0 "$(printed "$T/ws")" "$PROFILE" -C "$T/ws" --field _resolved.workspace
check "its Workflow folder is the folder itself" 0 "$(printed "$T/ws")" "$PROFILE" -C "$T/ws/api" --field workflow.folder
[ ! -e "$T/ws/.git" ] && ok "a chosen Workflow folder is taken as it is (no git init)" || bad "git init ran in $T/ws"
for r in api web; do
    [ "$(grep -cx '.claude/worktrees/' "$T/ws/$r/.git/info/exclude")" = 1 ] && ok "multi-repo: $r excludes .claude/worktrees/" || bad "multi-repo exclude of $r"
    [ -z "$(git -C "$T/ws/$r" status --porcelain --ignored --untracked-files=all)" ] && ok "multi-repo: $r shows nothing in git status --ignored" || bad "multi-repo $r status"
done

# --- a Harness home that is no git repository yet: git init, .gitignore, one commit ----------
SAVED="$HARNESS_HOME"
export HARNESS_HOME="$T/fresh"
repo "$T/solo"
draft solo full null "$T/solo" >"$T/solo.json"
check "a Full draft into a fresh Harness home is written" 0 '"workflowFolder": null' "$CONNECT" <"$T/solo.json"
[ "$(commits)" -eq 1 ] && ok "the fresh Harness home has one commit" || bad "fresh Harness home commits: $(commits)"
check "the fresh Harness home ignores the plugin copy" 0 "!/gate/config.json" cat "$HARNESS_HOME/.gitignore"
check "bin/profile -C prints full" 0 "full" "$PROFILE" -C "$T/solo" --field mode

# --- only the old registry, ~/.claude/gate/config.json ---------------
# bin/profile reads the old registry while HARNESS_HOME has none. The first Connect writes the new one, which from then
# on shadows the old: the Projects of the old registry are carried into it, so they stay known. The old file itself is
# not touched, and its entries count for the checks (a taken key or match).
export HARNESS_HOME="$T/fresh-legacy"
LEGACY="$HOME/.claude/gate/config.json"
mkdir -p "$(dirname "$LEGACY")" "$HOME/.claude/profiles/legacy"
repo "$T/legacy"
# The match as node reads it: C:/… in Git Bash on Windows (cygpath exists there), unchanged elsewhere. A /tmp/… path
# written into the file is not translated, and bin/profile would not find the project there.
LEGACY_MATCH="$(cygpath -m "$T/legacy" 2>/dev/null || printf '%s' "$T/legacy")"
printf '{"repos":[{"key":"legacy","match":"%s","profile":"legacy","pm":"npm","root":{},"workspace":{}}],"note":"kept"}\n' "$LEGACY_MATCH" >"$LEGACY"
printf '{"schema":2,"name":"legacy","mode":"full"}\n' >"$HOME/.claude/profiles/legacy/profile.json"
cp "$LEGACY" "$T/legacy-registry.0"
check "before: bin/profile knows the old registry's project" 0 "legacy" "$PROFILE" -C "$T/legacy" --name
draft taken full null "$T/legacy" >"$T/taken.json"
check "a match that is in the old registry is refused" 1 "already in the gate registry" "$CONNECT" --check <"$T/taken.json"
repo "$T/after-legacy"
draft after-legacy full null "$T/after-legacy" >"$T/after-legacy.json"
check "a Full draft with only the old registry is written" 0 '"workflowFolder": null' "$CONNECT" <"$T/after-legacy.json"
check "the new registry has the old registry's project and the new one" 0 "legacy after-legacy" \
    node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).repos; process.stdout.write(r.map(e=>e.key).join(" "))' "$HARNESS_HOME/gate/config.json"
check "the new registry keeps the old registry's other fields" 0 '"note": "kept"' cat "$HARNESS_HOME/gate/config.json"
check "after: bin/profile still knows the old registry's project" 0 "legacy" "$PROFILE" -C "$T/legacy" --name
check "after: bin/profile knows the new project" 0 "after-legacy" "$PROFILE" -C "$T/after-legacy" --name
cmp -s "$LEGACY" "$T/legacy-registry.0" && ok "the old registry is not changed" || bad "the old registry changed: $(cat "$LEGACY")"
export HARNESS_HOME="$T/fresh-legacy-broken"
printf '{"repos": {}}\n' >"$LEGACY"
repo "$T/after-broken"
draft after-broken full null "$T/after-broken" >"$T/after-broken.json"
# The path as the message prints it: on Windows (cygpath exists there) node's C:\… spelling, JSON-escaped, so every
# backslash doubled; unchanged elsewhere.
if command -v cygpath >/dev/null 2>&1; then LEGACY_SHOWN="$(cygpath -w "$LEGACY")"; LEGACY_SHOWN="${LEGACY_SHOWN//\\/\\\\}"
else LEGACY_SHOWN="$LEGACY"; fi
check "a broken old registry is refused with its path, nothing is written" 1 "$LEGACY_SHOWN cannot be read" "$CONNECT" <"$T/after-broken.json"
[ ! -e "$HARNESS_HOME/gate/config.json" ] && ok "a broken old registry: no new registry is written" || bad "a broken old registry: $(cat "$HARNESS_HOME/gate/config.json")"
rm -rf "$T/home/.claude/gate" "$T/home/.claude/profiles"
export HARNESS_HOME="$T/fresh"

# --- qmd: run only with qmd and downloaded models ----------------------------------
export QMD_INDEX_YML="$T/qmd/index.yml"
printf '#!/bin/sh\necho "qmd 2.8.3"\n' >"$T/bin/qmd"
# The stand-in qmd-collections notes the call and writes a qmd field into the profile, as the real one does.
cat >"$T/bin/qmd-collections" <<STUB
#!/bin/sh
echo "\$1" >>"$T/qmd-called"
node -e 'const f=process.argv[1]; const p=JSON.parse(require("fs").readFileSync(f,"utf8")); p.qmd={collections:[process.argv[2]+"-docs"]}; require("fs").writeFileSync(f, JSON.stringify(p,null,2)+"\\n")' "\$HARNESS_HOME/projects/\$1/profile.json" "\$1"
STUB
chmod +x "$T/bin/qmd" "$T/bin/qmd-collections"
# On Windows node starts neither the shell stub of qmd nor an extensionless shell stub of qmd-collections:
# qmd is node itself there (`node --version` exits 0), and each qmd-collections stub runs through a node
# stand-in, which project-connect starts with node. Elsewhere both are the shell stubs themselves.
QMD_STUB="$T/bin/qmd"
on_windows && QMD_STUB="$(command -v node)"
# stub_bin <shell stub>: prints what PROJECT_CONNECT_QMD_BIN names for that stub on this system.
stub_bin() { if on_windows; then node_stand_in "$1" "$1.mjs"; printf '%s' "$1.mjs"; else printf '%s' "$1"; fi; }
repo "$T/q1"
draft q1 full null "$T/q1" >"$T/q1.json"
check "qmd without downloaded models is skipped with the reason" 0 "models were not downloaded" \
    env PROJECT_CONNECT_QMD="$QMD_STUB" PROJECT_CONNECT_QMD_BIN="$(stub_bin "$T/bin/qmd-collections")" "$CONNECT" <"$T/q1.json"
printf 'downloaded\n' >"$HARNESS_HOME/qmd-models"
# A failure of the write itself, with qmd ready: qmd-collections never runs, nothing stays behind.
repo "$T/q0"
draft q0 full null "$T/q0" >"$T/q0.json"
before="$(state)"
check "a failed commit with qmd ready is exit 1" 1 "rolled back" \
    env PROJECT_CONNECT_FAIL_AT=commit PROJECT_CONNECT_QMD="$QMD_STUB" PROJECT_CONNECT_QMD_BIN="$(stub_bin "$T/bin/qmd-collections")" "$CONNECT" <"$T/q0.json"
[ ! -e "$T/qmd-called" ] && ok "qmd-collections did not run for a connection that was rolled back" || bad "qmd-collections ran: $(cat "$T/qmd-called")"
[ "$before" = "$(state)" ] && ok "the failed commit left nothing in the fresh Harness home" || bad "the failed commit left changes"
repo "$T/q2"
draft q2 full null "$T/q2" >"$T/q2.json"
check "qmd with downloaded models adds the collections" 0 '"status": "added"' \
    env PROJECT_CONNECT_QMD="$QMD_STUB" PROJECT_CONNECT_QMD_BIN="$(stub_bin "$T/bin/qmd-collections")" "$CONNECT" <"$T/q2.json"
check "qmd-collections ran for q2 only" 0 "q2" cat "$T/qmd-called"
check "the qmd field went into the one commit of q2" 0 "q2-docs" git -C "$HARNESS_HOME" show HEAD:projects/q2/profile.json
[ -z "$(git -C "$HARNESS_HOME" status --porcelain)" ] && ok "nothing left uncommitted after qmd" || bad "uncommitted after qmd: $(git -C "$HARNESS_HOME" status --porcelain)"
check "the q2 commit is the connection commit" 0 "Connect the project q2" git -C "$HARNESS_HOME" log -1 --format=%s
n_q="$(commits)"
printf '#!/bin/sh\necho broken >&2\nexit 1\n' >"$T/bin/qmd-fail"
chmod +x "$T/bin/qmd-fail"
repo "$T/q3"
draft q3 full null "$T/q3" >"$T/q3.json"
check "a failing qmd-collections keeps the connection, with the reason" 0 "qmd-collections failed: broken" \
    env PROJECT_CONNECT_QMD="$QMD_STUB" PROJECT_CONNECT_QMD_BIN="$(stub_bin "$T/bin/qmd-fail")" "$CONNECT" <"$T/q3.json"
[ "$(commits)" -eq $((n_q + 1)) ] && ok "q3 is one commit" || bad "q3 commits: $n_q -> $(commits)"
check "a qmd-collections that wrote nothing leaves the profile without a qmd field" 1 "" bash -c 'git -C "$1" show HEAD:projects/q3/profile.json | grep -q "\"qmd\""' _ "$HARNESS_HOME"
# qmd-collections writes index.yml and the profile field, then qmd update fails.
cat >"$T/bin/qmd-late-fail" <<STUB
#!/bin/sh
mkdir -p "$T/qmd"
printf 'collections:\n  \$1-docs: {}\n' >>"$T/qmd/index.yml"
"$T/bin/qmd-collections" "\$1"
echo "qmd update: refresh.lock is held" >&2
exit 1
STUB
chmod +x "$T/bin/qmd-late-fail"
n_q="$(commits)"
repo "$T/q4"
draft q4 full null "$T/q4" >"$T/q4.json"
check "qmd update failing after index.yml was written reports only that" 0 "the collections are set up, but qmd update failed: qmd update: refresh.lock is held" \
    env PROJECT_CONNECT_QMD="$QMD_STUB" PROJECT_CONNECT_QMD_BIN="$(stub_bin "$T/bin/qmd-late-fail")" "$CONNECT" <"$T/q4.json"
check "the profile keeps its qmd field, committed" 0 "q4-docs" git -C "$HARNESS_HOME" show HEAD:projects/q4/profile.json
[ "$(commits)" -eq $((n_q + 1)) ] && ok "q4 is one commit" || bad "q4 commits: $n_q -> $(commits)"
[ -z "$(git -C "$HARNESS_HOME" status --porcelain)" ] && ok "nothing left uncommitted after the late qmd failure" || bad "uncommitted: $(git -C "$HARNESS_HOME" status --porcelain)"
# A Node qmd-collections (the real one is) runs as `node <script>`, not by its #! line, which Windows
# does not read: this stand-in has no execute bit. "qmd" is node itself here (`node --version`
# exits 0), so the case runs where the shell stub of qmd cannot start (Windows).
cat >"$T/bin/qmd-collections-node" <<'STUB'
#!/usr/bin/env node
const fs = require("fs")
const name = process.argv[2]
fs.appendFileSync(process.env.QMD_NODE_LOG, name + "\n")
const file = require("path").join(process.env.HARNESS_HOME, "projects", name, "profile.json")
const profile = JSON.parse(fs.readFileSync(file, "utf8"))
profile.qmd = { collections: [name + "-docs"] }
fs.writeFileSync(file, JSON.stringify(profile, null, 2) + "\n")
STUB
repo "$T/q5"
draft q5 full null "$T/q5" >"$T/q5.json"
check "a Node qmd-collections without the execute bit runs through node" 0 '"status": "added"' \
    env QMD_NODE_LOG="$T/qmd-node-called" PROJECT_CONNECT_QMD="$(command -v node)" PROJECT_CONNECT_QMD_BIN="$T/bin/qmd-collections-node" "$CONNECT" <"$T/q5.json"
check "the Node qmd-collections got the project name" 0 "q5" cat "$T/qmd-node-called"
check "its qmd field went into the q5 commit" 0 "q5-docs" git -C "$HARNESS_HOME" show HEAD:projects/q5/profile.json
export HARNESS_HOME="$SAVED"

home_after="$(real_home_snapshot "$REAL_HOME")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
