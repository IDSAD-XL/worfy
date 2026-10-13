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
T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
# The gate exports its own registry to the tests it runs; this test has its own.
unset CLAUDE_GATE_CONFIG CLAUDE_GATE_RESOLVE CLAUDE_GATE_STATE CLAUDE_PROFILES_DIR PROJECT_CONNECT_FAIL_AT PROJECT_CONNECT_QMD_BIN
export HOME="$T/home"
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
  tickets: { root: ".scratch/", path: ".scratch/<эпик>/issues/NN-*.md", trail_section: "## Where in the code", spec: ".scratch/<эпик>/spec.md", branch: null },
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
check "--facts of a subfolder answers for the repository root" 0 "\"folder\": \"$T/f-remote\"" "$CONNECT" --facts "$T/f-remote/src"
repo "$T/f-plain"
check "--facts of a repository without remotes: none, origin null" 0 '"remotes": [],' "$CONNECT" --facts "$T/f-plain"
check "--facts of a repository without remotes: origin null" 0 '"origin": null' "$CONNECT" --facts "$T/f-plain"
mkdir -p "$T/f-ws"
repo "$T/f-ws/api"
repo "$T/f-ws/web"
mkdir -p "$T/f-ws/notes"
check "--facts of a folder above two repositories: multi-repo" 0 '"kind": "multi-repo"' "$CONNECT" --facts "$T/f-ws"
check "--facts lists both repositories" 0 "$T/f-ws/web" "$CONNECT" --facts "$T/f-ws"
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
check "--check passes and names the default Workflow folder" 0 "$HARNESS_HOME/projects/shop/workflow" "$CONNECT" --check <"$T/shop.json"
[ "$before" = "$(state)" ] && ok "--check and --schema-only write nothing" || bad "--check and --schema-only wrote into HARNESS_HOME"
n0="$(commits)"
check "a Silent draft is written" 0 '"profileDir": "'"$HARNESS_HOME/projects/shop"'"' bash -c 'set -o pipefail; "$1" <"$2" | tee "$3"' _ "$CONNECT" "$T/shop.json" "$T/shop.out"
[ -f "$HARNESS_HOME/projects/shop/profile.json" ] && [ -f "$HARNESS_HOME/projects/shop/rules.md" ] && ok "profile.json and rules.md in projects/shop/" || bad "projects/shop/ is incomplete"
check "the gate registry keeps the other project and adds shop" 0 "other shop" \
    node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).repos; process.stdout.write(r.map(e=>e.key).join(" "))' "$HARNESS_HOME/gate/config.json"
check "bin/profile -C <repository> --field mode prints silent" 0 "silent" "$PROFILE" -C "$T/shop" --field mode
check "bin/profile -C <repository> --name" 0 "shop" "$PROFILE" -C "$T/shop" --name
[ "$(jq -r .attribution "$HARNESS_HOME/projects/shop/profile.json")" = off ] && [ "$("$PROFILE" -C "$T/shop" --field attribution)" = off ] \
    && ok "a Silent draft is written with attribution off, and bin/profile prints off" || bad "Silent attribution: $(jq -c .attribution "$HARNESS_HOME/projects/shop/profile.json")"
check "the written workflow.folder is the default folder" 0 "$HARNESS_HOME/projects/shop/workflow" "$PROFILE" -C "$T/shop" --field workflow.folder
[ -d "$HARNESS_HOME/projects/shop/workflow/.git" ] && ok "the default Workflow folder is created with git" || bad "no $HARNESS_HOME/projects/shop/workflow/.git"
[ "$(commits)" -eq $((n0 + 1)) ] && ok "exactly one new commit in the git of HARNESS_HOME" || bad "commits: $n0 -> $(commits)"
check "the commit holds the profile, rules.md and the registry" 0 "gate/config.json" git -C "$HARNESS_HOME" show --name-only --format= HEAD
check "the Harness home's history leaves the Workflow folder out" 0 "/projects/*/workflow/" cat "$HARNESS_HOME/.gitignore"
[ -z "$(git -C "$HARNESS_HOME" status --porcelain)" ] && ok "HARNESS_HOME has nothing left uncommitted" || bad "HARNESS_HOME is dirty: $(git -C "$HARNESS_HOME" status --porcelain)"
[ -z "$(git -C "$T/shop" status --porcelain --ignored --untracked-files=all)" ] && ok "the project's repository is untouched" || bad "the repository changed: $(git -C "$T/shop" status --porcelain --ignored --untracked-files=all)"
[ "$(grep -cx '.claude/worktrees/' "$T/shop/.git/info/exclude")" = 1 ] && ok "Silent: .claude/worktrees/ is in .git/info/exclude once" || bad "exclude of shop: $(cat "$T/shop/.git/info/exclude")"
check "the output names the exclude file" 0 "$T/shop/.git/info/exclude" cat "$T/shop.out"
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
check "a linked worktree as the match is connected" 0 "$T/x-main/.git/info/exclude" "$CONNECT" <"$T/x-linked.json"
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
check "the folder above them resolves as the workspace" 0 "$T/ws" "$PROFILE" -C "$T/ws" --field _resolved.workspace
check "its Workflow folder is the folder itself" 0 "$T/ws" "$PROFILE" -C "$T/ws/api" --field workflow.folder
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
repo "$T/q1"
draft q1 full null "$T/q1" >"$T/q1.json"
check "qmd without downloaded models is skipped with the reason" 0 "models were not downloaded" \
    env PROJECT_CONNECT_QMD="$T/bin/qmd" PROJECT_CONNECT_QMD_BIN="$T/bin/qmd-collections" "$CONNECT" <"$T/q1.json"
printf 'downloaded\n' >"$HARNESS_HOME/qmd-models"
# A failure of the write itself, with qmd ready: qmd-collections never runs, nothing stays behind.
repo "$T/q0"
draft q0 full null "$T/q0" >"$T/q0.json"
before="$(state)"
check "a failed commit with qmd ready is exit 1" 1 "rolled back" \
    env PROJECT_CONNECT_FAIL_AT=commit PROJECT_CONNECT_QMD="$T/bin/qmd" PROJECT_CONNECT_QMD_BIN="$T/bin/qmd-collections" "$CONNECT" <"$T/q0.json"
[ ! -e "$T/qmd-called" ] && ok "qmd-collections did not run for a connection that was rolled back" || bad "qmd-collections ran: $(cat "$T/qmd-called")"
[ "$before" = "$(state)" ] && ok "the failed commit left nothing in the fresh Harness home" || bad "the failed commit left changes"
repo "$T/q2"
draft q2 full null "$T/q2" >"$T/q2.json"
check "qmd with downloaded models adds the collections" 0 '"status": "added"' \
    env PROJECT_CONNECT_QMD="$T/bin/qmd" PROJECT_CONNECT_QMD_BIN="$T/bin/qmd-collections" "$CONNECT" <"$T/q2.json"
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
    env PROJECT_CONNECT_QMD="$T/bin/qmd" PROJECT_CONNECT_QMD_BIN="$T/bin/qmd-fail" "$CONNECT" <"$T/q3.json"
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
    env PROJECT_CONNECT_QMD="$T/bin/qmd" PROJECT_CONNECT_QMD_BIN="$T/bin/qmd-late-fail" "$CONNECT" <"$T/q4.json"
check "the profile keeps its qmd field, committed" 0 "q4-docs" git -C "$HARNESS_HOME" show HEAD:projects/q4/profile.json
[ "$(commits)" -eq $((n_q + 1)) ] && ok "q4 is one commit" || bad "q4 commits: $n_q -> $(commits)"
[ -z "$(git -C "$HARNESS_HOME" status --porcelain)" ] && ok "nothing left uncommitted after the late qmd failure" || bad "uncommitted: $(git -C "$HARNESS_HOME" status --porcelain)"
export HARNESS_HOME="$SAVED"

home_after="$(real_home_snapshot "$REAL_HOME")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
