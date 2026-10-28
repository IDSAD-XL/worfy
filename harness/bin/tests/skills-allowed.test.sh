#!/usr/bin/env bash
# The skills.allowed contract: the profile field with the user's plugins and skills that the sessions
# worfy starts in a project get. Checked here: the profile contract (profiles/README.md), the draft
# schema (run through bin/project-connect --schema-only: a profile with skills.allowed and without it
# passes, a value of the wrong type fails), and bin/profile reading the field (exit 4 without it).
# Run: bash harness/bin/tests/skills-allowed.test.sh; exit code 0 means every check passed.
# PROFILES_README / CONNECT_BIN point it at other copies.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
RD="${PROFILES_README:-$HARNESS/profiles/README.md}"
CONNECT="${CONNECT_BIN:-$HARNESS/bin/project-connect}"
. "$(dirname "$0")/gh-stand-in.sh" # node_path
# node_path: C:/… in Git Bash on Windows, the spelling git prints and node reads (review-depth.test.sh).
T="$(mktemp -d)"; T="$(cd "$T" && node_path "$(pwd -P)")"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
flat() { tr '\n' ' ' | tr -s ' '; }
in_text() { [[ "$1" == *"$2"* ]]; }

for f in "$RD" "$CONNECT"; do
    [ -f "$f" ] || { echo "FAIL missing $f"; echo "passed $pass, failed $((fail + 1))"; exit 1; }
done
rd="$(flat <"$RD")"

# --- 1. The profile contract ------------------------------------------------------------------------
check "README: a row for skills.allowed" grep -qF '| `skills.allowed` | strings \| absent |' "$RD"
check "README: absent — every plugin and skill of the user" in_text "$rd" 'Absent — exit 4, and the session gets every plugin and skill of the user, as without the field'
check "README: the Harness plugin always stays" in_text "$rd" 'The Harness plugin `worfy`, the project'"'"'s own `.claude/skills` and the skills built into Claude Code always stay'
check "README: claude.ai keeps the synced skills and plugins" in_text "$rd" '`claude.ai` for the skills and plugins synced from claude.ai'

# --- 2. The draft schema: with skills.allowed, without it, a value of the wrong type -----------------
# draft <skills JSON or empty> — a Full mode draft as skill connect-project proposes it.
draft() {
    node - "$1" "$T/repo" <<'NODE'
const [skills, match] = process.argv.slice(2)
const profile = {
  schema: 2, name: "shop", title: "shop", mode: "full",
  language: { reports: "en", team: "en", docs: "en" }, attribution: "on",
  layout: { summary: "one package", packages: ["."], repos: null }, stack: ["node"],
  commands: { install: "npm ci", lint: "npm run lint", typecheck: null, test: "npm test", test_one: null, contract: null, e2e: null,
              build: null, verify: "npm run lint && npm test", prepare_tree: "npm ci", requires: [] },
  parallel: "worktrees",
  worktree: { root: match + "/.claude/worktrees/", base: "origin/main", implementer: null, reviewer: null },
  tickets: { root: ".scratch/", path: ".scratch/<epic>/issues/NN-*.md", trail_section: "## Where in the code", spec: ".scratch/<epic>/spec.md", branch: null },
  workflow: { folder: null, ticket_skill: "ship-ticket", implementer_steps: "steps 1-8", finish: "local-green", merge: "orchestrator" },
  numbering: null, deploy: null, github: { account: null }, docs: null, lessons: "repo:docs/lessons",
  mcp: { allowed: ["plugin_worfy_qmd", "worfy-canvas"] }, review: { lenses: ["correctness"], ticket_lenses: ["correctness"] },
}
if (skills !== "") profile.skills = JSON.parse(skills)
const gate = [{ key: "shop", match, profile: "shop", pm: "npm", root: { fast: ["lint", "test"], full: ["lint", "test"] }, workspace: {} }]
process.stdout.write(JSON.stringify({ profile, rules: "# shop\n\n## Sources\n\n- package.json\n", gate }))
NODE
}
# schema <name> <expected exit> <expected output fragment> <skills JSON or empty>
schema() {
    local name="$1" want="$2" frag="$3" out code
    draft "$4" >"$T/draft.json" || { bad "$name (the draft was not built)"; return; }
    out="$(HARNESS_HOME="$T/hh" "$CONNECT" --schema-only <"$T/draft.json" 2>&1)"; code=$?
    if [ "$code" -eq "$want" ] && in_text "$out" "$frag"; then ok "$name"; else bad "$name (exit $code: $(printf '%s' "$out" | head -c 400))"; fi
}
mkdir -p "$T/hh" "$T/repo"
schema "schema: a profile without skills passes" 0 '"ok": true' ""
schema "schema: skills.allowed with names passes" 0 '"ok": true' '{"allowed":["figma","claude.ai","wrangler"]}'
schema "schema: an empty skills.allowed passes" 0 '"ok": true' '{"allowed":[]}'
schema "schema: skills.allowed as a string is refused, the field named" 1 '"path": "profile.skills.allowed"' '{"allowed":"figma"}'
schema "schema: a name that is a number is refused" 1 '"path": "profile.skills.allowed[0]"' '{"allowed":[3]}'
schema "schema: an empty name is refused" 1 '"path": "profile.skills.allowed[0]"' '{"allowed":[""]}'
schema "schema: skills without allowed is refused" 1 '"path": "profile.skills.allowed"' '{}'
schema "schema: an unknown skills field is refused" 1 '"path": "profile.skills.alowed"' '{"allowed":[],"alowed":[]}'
check "schema: --schema-only wrote nothing into HARNESS_HOME" test -z "$(ls -A "$T/hh")"

# --- 3. bin/profile reads the field; a profile without it gives exit 4 --------------------------------
PROFILE="$HARNESS/bin/profile"
mkdir -p "$T/p/with" "$T/p/without" "$T/r1" "$T/r2"
git -C "$T/r1" init -q -b main; git -C "$T/r2" init -q -b main
printf '{"schema":2,"name":"with","mode":"full","skills":{"allowed":["figma","claude.ai"]}}\n' >"$T/p/with/profile.json"
printf '{"schema":2,"name":"without","mode":"full"}\n' >"$T/p/without/profile.json"
printf '{"repos":[{"key":"with","match":"%s","profile":"with"},{"key":"without","match":"%s","profile":"without"}]}\n' "$T/r1" "$T/r2" >"$T/config.json"
# field <repo> <field> — prints "<exit>:<value>"
field() { local v c; v="$(CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/p" "$PROFILE" -C "$1" --field "$2" 2>/dev/null)"; c=$?; printf '%s:%s' "$c" "$v"; }
got="$(field "$T/r1" skills.allowed)"
check "profile: skills.allowed is read as a JSON list (got $got)" bash -c '[[ "$1" == 0:* ]] && node -e "const v=JSON.parse(process.argv[1]); if (JSON.stringify(v)!==JSON.stringify([\"figma\",\"claude.ai\"])) process.exit(1)" "${1#0:}"' _ "$got"
check "profile: no skills — skills.allowed is exit 4" test "$(field "$T/r2" skills.allowed)" = "4:"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
