#!/usr/bin/env bash
# The shell blocks of the cross-machine gate, cut out of the skills and run under bash and zsh with a stub gh: the
# label and the checks section of skills/ship-ticket step 8, the serve pass of skills/gate-queue (the list, the
# rebase against a bare origin, the conflict follow-up, the report and the merge under the main-branch lock), and the
# request blocks of skills/epic-wave section 1 (the fresh base, the report lookup, the open PRs of other epics).
# The world, the block cutters and the Silent project are in skill-blocks-world.sh; the other blocks are in
# skill-blocks.test.sh.
# Run: bash harness/bin/tests/skill-blocks-gate.test.sh; exit code 0 — everything passed.
# SKILL_ARGS — the arguments of the call (default ten words, a to j).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/skill-blocks-world.sh"
# gh_guard and refusing_gh_exe: no gh the blocks can start is the real one.
. "$HERE/gh-stand-in.sh"
REAL_GIT="$(type -P git)"

# The cross-machine gate: a project with cross_machine_gate in the sandbox HARNESS_HOME, and a stub
# gh: `--jq <filter>` applies the filter (real jq) to $GH_JSON, `--body-file <f>` keeps a copy of <f> in $GH_BODY_OUT,
# every call is logged. No token reaches it, and nothing reaches GitHub.
CM="$T/cm"; CR="$CM/repo"; mkdir -p "$CM" "$SHH/projects/cm"
git -C "$CM" init -q --bare -b main origin.git && git -C "$CM" clone -q origin.git repo 2>/dev/null
printf '{"repos":[{"key":"sp","match":"%s","profile":"sp"},{"key":"cm","match":"%s","profile":"cm"}]}\n' "$(native "$SR")" "$(native "$CR")" >"$SHH/gate/config.json"
CMP='{"schema":2,"name":"cm","mode":"full","tickets":{"branch":"<эпик>/<NN>"},"github":{"account":"mac-bot"},"worktree":{"base":"origin/main"},"cross_machine_gate":{"label":"needs-mac-gate","role":"request","exempt":[".scratch/","docs/","HANDOFF.md"],"checks_section":"Mac checks"}}'
printf '%s\n' "$CMP" >"$SHH/projects/cm/profile.json"
GHX="$T/ghx"; mkdir -p "$GHX"
cat >"$GHX/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"; echo "$*" >>"$GH_ALL"
f=""; prev=""
for a in "$@"; do
  [ "$prev" = --jq ] && f=$a
  [ "$prev" = --body-file ] && cp "$a" "$GH_BODY_OUT"
  prev=$a
done
[ -n "${GH_FAIL:-}" ] && { echo "HTTP 502: Bad Gateway (https://api.github.com/graphql)" >&2; exit 1; }
[ -n "${GH_FAIL_ON:-}" ] && [[ " $* " == *" $GH_FAIL_ON "* ]] && { echo "HTTP 502: Bad Gateway (https://api.github.com/graphql)" >&2; exit 1; }
[ -n "${GH_BODY_RAW:-}" ] && [[ " $* " == *" --json body "* ]] && { cat "$GH_BODY_RAW"; exit 0; }
[ -n "${GH_LOCK:-}" ] && [[ " $* " == *" pr merge "* ]] && { [ -d "$GH_LOCK" ] && echo held || echo free; } >>"$GH_LOCK_LOG"
[ -n "${GH_TERM_ON:-}" ] && [[ " $* " == *" $GH_TERM_ON "* ]] && { kill -TERM "$PPID"; exit 1; }   # the call is stopped
if [ -n "$f" ]; then set -o pipefail; jq -r "$f" "$GH_JSON" | tr -d '\r'; exit $?; fi
exit 0
EOF
chmod +x "$GHX/gh"
refusing_gh_exe "$GHX/gh"
( PATH="$GHX:$PATH"; gh_guard - "$GHX/gh" "$GHX/gh" ) || exit 1
XENV=(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$GHX:$PATH" GH_LOG="$T/ghx.log" GH_ALL="$T/ghx-all.log" GH_JSON="$T/ghx.json" GH_BODY_OUT="$T/ghx-body.md" GH_CONFIG_DIR="$T/gh-config")

# The label block of skills/ship-ticket, step 8: the PR's files against cross_machine_gate.exempt.
BLB="$(SKILL="$SHIP" blockf 'cross_machine_gate.exempt')"
[ -n "$BLB" ] || bad "label block not found in $SHIP"
printf -- '- `pnpm icons` — exit 0\n' >"$T/section.md"
BLB="$(sub "${BLB//<repo>/$CR}")"; BLB="${BLB//<N>/7}"; BLB="${BLB//<scratchpad>/$T}"; BLB="${BLB//<section file>/$T/section.md}"
label_case() { # label_case <want: label|no-label> <name> <body> <file>...
    local want="$1" name="$2" body="$3" sh got; shift 3
    jq -n --arg body "$body" '{body: $body, files: [$ARGS.positional[] | {path: .}]}' --args "$@" >"$T/ghx.json"
    for sh in "${SHELLS[@]}"; do
        : >"$T/ghx.log"; rm -f "$T/ghx-body.md" "$T/pr-7-body.md"
        got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BLB" 2>&1)"
        if [ "$want" = no-label ]; then
            [ "$got" = no-label ] && ! grep -q '^pr edit' "$T/ghx.log" && [ ! -e "$T/ghx-body.md" ] \
                && ok "$sh: label block, $name -> no-label, gh pr edit not called" || bad "$sh: label block, $name: [$got] gh [$(cat "$T/ghx.log")]"
        else
            [ "$got" = $'label\nEXIT=0' ] && grep -qxF 'pr edit 7 --add-label needs-mac-gate --body-file '"$T/pr-7-body.md" "$T/ghx.log" \
                && grep -qxF 'Old description.' "$T/ghx-body.md" && grep -qxF '## Mac checks' "$T/ghx-body.md" && grep -qxF -- '- `pnpm icons` — exit 0' "$T/ghx-body.md" \
                && [ "$(grep -c '^## Mac checks$' "$T/ghx-body.md")" = 1 ] \
                && ok "$sh: label block, $name -> label, --add-label needs-mac-gate and --body-file with the old description and ## Mac checks" \
                || bad "$sh: label block, $name: [$got] gh [$(cat "$T/ghx.log")] body [$(cat "$T/ghx-body.md" 2>&1)]"
        fi
    done
}
label_case no-label "files in exempt folders and an exempt file" 'Old description.' .scratch/worfy-windows/issues/07-t.md docs/adr/0069-x.md HANDOFF.md
label_case label "one file outside exempt" 'Old description.' docs/adr/0069-x.md harness/skills/epic-wave/SKILL.md
label_case label "a folder entry covers only paths under it (docsx/)" 'Old description.' docsx/a.md
label_case label "a file entry is the whole path (HANDOFF.md.bak)" 'Old description.' HANDOFF.md.bak
label_case label "a description that already has the section gets no second one" $'Old description.\n\n## Mac checks\n\n- `pnpm icons` — exit 0' harness/x.sh
label_error_case() { # label_error_case <name> <env assignment> <ERROR text> <file>...: gh fails or lists no files -> ERROR, never no-label
    local name="$1" e="$2" msg="$3" sh got; shift 3
    jq -n --arg body 'Old description.' '{body: $body, files: [$ARGS.positional[] | {path: .}]}' --args "$@" >"$T/ghx.json"
    for sh in "${SHELLS[@]}"; do
        : >"$T/ghx.log"; rm -f "$T/ghx-body.md"
        got="$("${SENV[@]}" "${XENV[@]}" $e $sh -c "$BLB" 2>&1)"
        grep -q "^ERROR: .*$msg" <<<"$got" && [[ "$got" != *no-label* ]] && ! grep -q '^pr edit' "$T/ghx.log" \
            && ok "$sh: label block, $name -> ERROR, no label decision, gh pr edit not called" || bad "$sh: label block, $name: [$got] gh [$(cat "$T/ghx.log")]"
    done
}
label_error_case "gh answers HTTP 502" GH_FAIL=1 'failed' harness/x.sh
label_error_case "the PR lists no files yet" GH_FAIL= 'lists no files'
# Only the description read fails: without the guard the block went on and replaced the whole description
# with the section alone.
label_error_case "gh fails on reading the description" GH_FAIL_ON=body 'json body failed' harness/x.sh
# bin/profile exit 1 (a broken cross_machine_gate) is an ERROR, exit 4 (no such field) is the skip.
jq -n '{body: "Old description.", files: [{path: "harness/x.sh"}]}' >"$T/ghx.json"
jq '.cross_machine_gate.role = "merge"' <<<"$CMP" >"$SHH/projects/cm/profile.json"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BLB" 2>&1)"
    [[ "$got" == "ERROR: bin/profile exit 1"* ]] && [ ! -s "$T/ghx.log" ] \
        && ok "$sh: label block, a broken profile (exit 1) -> ERROR, gh not called" || bad "$sh: label block, broken profile: [$got] gh [$(cat "$T/ghx.log")]"
done
jq 'del(.cross_machine_gate)' <<<"$CMP" >"$SHH/projects/cm/profile.json"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BLB" 2>&1)"
    [ "$got" = "label step skipped: cross_machine_gate.role is absent" ] && [ ! -s "$T/ghx.log" ] \
        && ok "$sh: label block, no cross_machine_gate (exit 4) -> skipped, gh not called" || bad "$sh: label block, no field: [$got]"
done
printf '%s\n' "$CMP" >"$SHH/projects/cm/profile.json"
# A description edited on the web comes with CRLF: its section is found, no second one is added.
jq -n '{body: "Old description.", files: [{path: "harness/x.sh"}]}' >"$T/ghx.json"
printf 'Old description.\r\n\r\n## Mac checks\r\n\r\n- `pnpm icons` — exit 0\r\n' >"$T/ghx-crlf-body.md"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"; rm -f "$T/ghx-body.md"
    got="$("${SENV[@]}" "${XENV[@]}" GH_BODY_RAW="$T/ghx-crlf-body.md" $sh -c "$BLB" 2>&1)"
    [ "$got" = $'label\nEXIT=0' ] && [ "$(tr -d '\r' <"$T/ghx-body.md" | grep -c '^## Mac checks$')" = 1 ] \
        && ok "$sh: label block, a CRLF description that has the section gets no second one" || bad "$sh: label block, CRLF description: [$got] body [$(cat "$T/ghx-body.md" 2>&1)]"
done

# The checks section block of skills/gate-queue, step 3: the section's lines up to the next heading. The pass is written
# only there: skills/epic-wave section 1 runs skills/gate-queue and has no copy of the block.
BCS="$(SKILL="$GQF" blockf 'no-section')"
[ -n "$BCS" ] || bad "checks section block not found in $GQF"
[ -z "$(SKILL="$WAVE" blockf 'no-section')" ] && ok "the checks section block is not in $WAVE" || bad "the checks section block is still in $WAVE"
BCS="$(sub "${BCS//<repo>/$CR}")"; BCS="${BCS//<N>/7}"
section_case() { # section_case <name> <want> <body>
    jq -n --arg body "$3" '{body: $body}' >"$T/ghx.json"
    for sh in "${SHELLS[@]}"; do
        got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BCS" 2>&1)"
        [ "$got" = "$2" ] && ok "$sh: checks section block, $1" || bad "$sh: checks section block, $1: got [$got] want [$2]"
    done
}
TWO=$'- `pnpm icons` — exit 0\n- `git add --renormalize . && git status --porcelain` — empty output'
section_case "two commands, the next heading ends the section" "$TWO" \
    $'Intro.\n\n## Mac checks\n\n- `pnpm icons` — exit 0\n- `git add --renormalize . && git status --porcelain` — empty output\n\n## Windows checks\n\n- `bash x.test.sh` — exit 0'
section_case "CRLF line ends" "$TWO" \
    $'Intro.\r\n\r\n## Mac checks\r\n\r\n- `pnpm icons` — exit 0\r\n- `git add --renormalize . && git status --porcelain` — empty output\r\n'
section_case "none" none $'## Summary\n\nx\n\n## Mac checks\n\nnone\n'
section_case "no section" no-section $'## Summary\n\nNo checks here.\n\n## Windows checks\n\n- `x` — exit 0'
section_case "a level-1 heading ends it too" '- `a` — exit 0' $'## Mac checks\n- `a` — exit 0\n# Notes\n- `b` — exit 0'
section_case "a level-3 heading stays in the section" $'- `a` — exit 0\n### Notes\n- `b` — exit 0' $'## Mac checks\n- `a` — exit 0\n### Notes\n- `b` — exit 0\n## Next\n- `c`'
section_case "a # comment inside a code block stays in the section" $'```bash\n# comment\npnpm icons\n```\n- `b` — exit 0' \
    $'## Mac checks\n\n```bash\n# comment\npnpm icons\n```\n- `b` — exit 0\n\n## Next\n- `c`'
section_case "an empty section" no-section $'## Mac checks\n\n## Windows checks\n\n- `x` — exit 0'

# The serve pass of skills/gate-queue against a bare origin, with F worktree.base origin/main as in the
# live profile. The list skips fork PRs. The rebase block takes the branch as origin has it (a stale local branch
# from an earlier pass would push a rework away), pushes with a lease on the listed head, prints the new head.
G=(-c user.email=t@t -c user.name=t)
git -C "$CR" "${G[@]}" commit -q --allow-empty -m base && git -C "$CR" push -q origin main 2>/dev/null
git -C "$CR" checkout -q -b feature && echo f >"$CR/f.txt" && git -C "$CR" add f.txt && git -C "$CR" "${G[@]}" commit -q -m feature \
    && git -C "$CR" push -q origin feature 2>/dev/null && git -C "$CR" checkout -q main      # the local feature: stale from now on
git -C "$CM" clone -q origin.git other 2>/dev/null && git -C "$CM/other" "${G[@]}" commit -q --allow-empty -m moved && git -C "$CM/other" push -q origin main 2>/dev/null
git -C "$CM/other" checkout -q feature 2>/dev/null && echo r >"$CM/other/r.txt" && git -C "$CM/other" add r.txt \
    && git -C "$CM/other" "${G[@]}" commit -q -m rework && git -C "$CM/other" push -q origin feature 2>/dev/null   # the rework of the request machine
tip="$(git -C "$CM/origin.git" rev-parse main)"; rework="$(git -C "$CM/origin.git" rev-parse feature)"
BSL="$(SKILL="$GQF" blockf 'isCrossRepository')"
[ -n "$BSL" ] || bad "serve list block not found in $GQF"
BSL="$(sub "${BSL//<repo>/$CR}")"
printf '%s\n' '[{"number":7,"headRefName":"feature","headRefOid":"'"$rework"'","isCrossRepository":false,"createdAt":"2026-10-18T06:00:00Z","commits":[{"committedDate":"2026-10-18T07:00:00Z"}],"comments":[]},
 {"number":8,"headRefName":"evil","headRefOid":"0123","isCrossRepository":true,"createdAt":"2026-10-18T08:00:00Z","commits":[],"comments":[]}]' >"$T/ghx.json"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BSL" 2>&1)"
    [ "$got" = "7 feature $rework since 2026-10-18T07:00:00Z"$'\n'"8 fork: skipped"$'\n'"EXIT=0" ] && grep -q -- '--json number,headRefName,headRefOid,isCrossRepository' "$T/ghx.log" \
        && ok "$sh: serve list block: a fork PR is skipped, the others come with their head" || bad "$sh: serve list block: [$got]"
done
BSV="$(SKILL="$GQF" blockf 'gone() {')"
[ -n "$BSV" ] || bad "serve rebase block not found in $GQF"
BSV="$(sub "${BSV//<repo>/$CR}")"; BSV="${BSV//<scratchpad>/$CM}"; BSV="${BSV//<branch>/feature}"
serve_rebase() { local b="${BSV//<N>/$1}"; b="${b//<head>/$2}"; "${SENV[@]}" ${RSH:-bash} -c "$b" 2>&1; }   # RSH: the shell
got="$(serve_rebase 7 "$rework")"; new="$(grep -E '^[0-9a-f]{40}$' <<<"$got" | tail -n 1)"
[ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$new" ] \
    && git -C "$CM/origin.git" merge-base --is-ancestor "$tip" "$new" && git -C "$CM/origin.git" cat-file -e "$new:r.txt" 2>/dev/null \
    && ok "serve rebase block: a stale local branch — the rework is kept, rebased onto origin/main, pushed, new head printed" \
    || bad "serve rebase block, stale local branch: [$got] origin feature has r.txt: $(git -C "$CM/origin.git" cat-file -e feature:r.txt 2>&1 && echo yes)"
git -C "$CR" worktree remove --force "$CM/pr-7"
# A push to the branch while the block runs, then a fetch (an editor's background fetch): the lease on the listed
# head refuses the push; a lease on the remote-tracking ref would take the fetched head and push that push away.
RG="$T/racegit"; mkdir -p "$RG"; : >"$T/race"
cat >"$RG/git" <<RACE
#!/usr/bin/env bash
if [ -e "$T/race" ] && [[ " \$* " == *" push "* ]]; then
  rm -f "$T/race"
  "$REAL_GIT" -C "$CM/other" fetch -q origin && "$REAL_GIT" -C "$CM/other" checkout -q -B feature origin/feature && echo \$\$ >"$CM/other/y.txt" && "$REAL_GIT" -C "$CM/other" add y.txt && "$REAL_GIT" -C "$CM/other" -c user.email=t@t -c user.name=t commit -q -m race && "$REAL_GIT" -C "$CM/other" push -q origin feature 2>/dev/null && "$REAL_GIT" -C "$CR" fetch -q origin
fi
exec "$REAL_GIT" "\$@"
RACE
chmod +x "$RG/git"
b="${BSV//<N>/8}"; b="${b//<head>/$new}"; got="$("${SENV[@]}" PATH="$RG:$PATH" bash -c "$b" 2>&1)"
[ ! -e "$T/race" ] && [ "$(git -C "$CM/origin.git" log -1 --format=%s feature)" = race ] && [ "$(tail -n 1 <<<"$got")" != EXIT=0 ] && [ ! -e "$CM/pr-8" ] \
    && ok "serve rebase block: a push while the block runs — the push is refused, origin keeps that push, the tree is removed" || bad "serve rebase block, push while the block runs: [$got]"
new="$(git -C "$CM/origin.git" rev-parse feature)"
[ ! -e "$CM/pr-8" ] || git -C "$CR" worktree remove --force "$CM/pr-8"
# The pass again from the list after a refused push — the same PR, the same scratchpad — while the other machine
# pushes once more: the retry starts from origin's branch, and both pushes of the other machine stay on origin.
retry_case() { # retry_case <shell> <N>
    local sh="$1" n="$2" b got1 got second head
    head="$(git -C "$CM/origin.git" rev-parse feature)"; : >"$T/race"
    b="${BSV//<N>/$n}"; b="${b//<head>/$head}"; got1="$("${SENV[@]}" PATH="$RG:$PATH" $sh -c "$b" 2>&1)"
    git -C "$CM/other" fetch -q origin && git -C "$CM/other" checkout -q -B feature origin/feature && echo "$sh $n" >"$CM/other/z.txt" \
        && git -C "$CM/other" add z.txt && git -C "$CM/other" "${G[@]}" commit -q -m second && git -C "$CM/other" push -q origin feature 2>/dev/null
    second="$(git -C "$CM/origin.git" rev-parse feature)"
    got="$(RSH=$sh serve_rebase "$n" "$second")"
    [ "$(tail -n 1 <<<"$got1")" != EXIT=0 ] && [ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && git -C "$CM/origin.git" merge-base --is-ancestor "$second" feature \
        && ok "$sh: serve rebase block: a retry after a refused push — the other machine's commits stay on origin" \
        || bad "$sh: serve rebase block, retry: first [$(tail -n 1 <<<"$got1")] retry [$got] origin feature $(git -C "$CM/origin.git" log --format=%s -3 feature | tr '\n' ' ')"
    [ ! -e "$CM/pr-$n" ] || git -C "$CR" worktree remove --force "$CM/pr-$n"
}
# A tree left from an earlier try (no worktree remove by hand) is removed first; a tree deleted by hand that git still
# lists is pruned first: both runs reach the rebase and the push.
leftover_case() { # leftover_case <shell> <N>
    local sh="$1" n="$2" head got got2 got3
    head="$(git -C "$CM/origin.git" rev-parse feature)"
    got="$(RSH=$sh serve_rebase "$n" "$head")"
    got2="$(RSH=$sh serve_rebase "$n" "$head")"
    [ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && [ "$(tail -n 1 <<<"$got2")" = EXIT=0 ] && grep -qE '^[0-9a-f]{40}$' <<<"$got2" \
        && ok "$sh: serve rebase block: a tree left from an earlier try of the PR is removed first" || bad "$sh: serve rebase block, leftover tree: [$got2]"
    rm -rf "$CM/pr-$n"
    got3="$(RSH=$sh serve_rebase "$n" "$head")"
    [ "$(tail -n 1 <<<"$got3")" = EXIT=0 ] && [ -d "$CM/pr-$n" ] \
        && ok "$sh: serve rebase block: a tree deleted by hand that git still lists is pruned first" || bad "$sh: serve rebase block, tree deleted by hand: [$got3]"
    [ ! -e "$CM/pr-$n" ] || git -C "$CR" worktree remove --force "$CM/pr-$n"
}
for sh in "${SHELLS[@]}"; do retry_case "$sh" 10; leftover_case "$sh" 12; done
new="$(git -C "$CM/origin.git" rev-parse feature)"
# worktree.base null: the main branch, not `git rebase null` (and the request block below the same).
jq '.worktree.base = null' <<<"$CMP" >"$SHH/projects/cm/profile.json"
got="$(serve_rebase 9 "$new")"
[ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && ok "serve rebase block: worktree.base null -> origin/main" || bad "serve rebase block, base null: [$got]"
git -C "$CR" worktree remove --force "$CM/pr-9"
BRQ="$(SKILL="$WAVE" blockf 'base-gate "$B"')"
[ -n "$BRQ" ] || bad "request fresh-base block not found in $WAVE"
BRQ="$(sub "${BRQ//<repo>/$CR}")"; BRQ="${BRQ//<scratchpad>/$CM}"; BRQ="${BRQ//<F commands.prepare_tree>/git rev-parse HEAD}"
for base in null origin/main; do
    jq --arg b "$base" '.worktree.base = (if $b == "null" then null else $b end)' <<<"$CMP" >"$SHH/projects/cm/profile.json"
    got="$("${SENV[@]}" bash -c "$BRQ" 2>&1 | grep -E '^(EXIT=|[0-9a-f]{40}$)')"   # git's progress lines dropped
    [ "$got" = "EXIT=0"$'\n'"$tip"$'\n'"EXIT=0" ] && [ ! -e "$CM/base-gate" ] \
        && ok "request fresh-base block: base $base — a detached worktree on origin/main, removed after" || bad "request fresh-base block, base $base: [$got] want [EXIT=0 $tip EXIT=0]"
done
printf '%s\n' "$CMP" >"$SHH/projects/cm/profile.json"
# A rebase conflict stops the block before the push: nothing half-rebased reaches origin.
git -C "$CM/other" checkout -q main && git -C "$CM/other" pull -q origin main 2>/dev/null; echo conflict >"$CM/other/f.txt" \
    && git -C "$CM/other" add f.txt && git -C "$CM/other" "${G[@]}" commit -q -m conflict && git -C "$CM/other" push -q origin main 2>/dev/null
before="$(git -C "$CM/origin.git" rev-parse feature)"
got="$(serve_rebase 11 "$before")"
[ "$(tail -n 1 <<<"$got")" != EXIT=0 ] && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$before" ] \
    && ok "serve rebase block: a rebase conflict stops the block — origin keeps the branch, nothing half-rebased is pushed" \
    || bad "serve rebase block, conflict: [$got] origin feature $(git -C "$CM/origin.git" log --format=%s -1 feature)"
# The second block after a resolved state-file conflict. With the path lost (a fresh shell: P empty or unset) and the
# current folder a tree with a resolved rebase of its own, it refuses and pushes nothing.
BCT="$(SKILL="$GQF" blockf 'rebase --continue')"
[ -n "$BCT" ] || bad "conflict follow-up block not found in $GQF"
BCT="$(sub "${BCT//<repo>/$CR}")"; BCT="${BCT//<scratchpad>/$CM}"; BCT="${BCT//<branch>/feature}"; BCT="${BCT//<N>/11}"; BCT="${BCT//<head>/$before}"
git -C "$CR" worktree add -q --detach "$CM/cwdwt" "$before" 2>/dev/null; git -C "$CM/cwdwt" rebase -q origin/main >/dev/null 2>&1
echo resolved >"$CM/cwdwt/f.txt"; git -C "$CM/cwdwt" add f.txt
for sh in "${SHELLS[@]}"; do
    for lost in 'P=' ':' "P=$CM/cwdwt"; do   # empty, unset, a path to another tree
        pline="P=$CM/pr-11"; b="${BCT/$pline/$lost}"
        got="$(cd "$CM/cwdwt" && "${SENV[@]}" $sh -c "$b" 2>&1)"
        [[ "$got" == REFUSED:* ]] && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$before" ] \
            && ok "$sh: conflict follow-up block: the path lost ([$lost]) -> refused, nothing pushed" \
            || bad "$sh: conflict follow-up block, path lost [$lost]: [$got] origin feature $(git -C "$CM/origin.git" log --format=%s -1 feature)"
    done
done
git -C "$CM/cwdwt" rebase --abort 2>/dev/null; git -C "$CR" worktree remove --force "$CM/cwdwt"
# The other machine pushes to the branch while this one resolves the conflict: the lease on the listed head refuses
# the push, origin keeps the other machine's commit, and the tree is removed.
echo resolved >"$CM/pr-11/f.txt"; git -C "$CM/pr-11" add f.txt
git -C "$CM/other" fetch -q origin && git -C "$CM/other" checkout -q -B feature origin/feature && echo moved >"$CM/other/m.txt" \
    && git -C "$CM/other" add m.txt && git -C "$CM/other" "${G[@]}" commit -q -m "moved while resolving" && git -C "$CM/other" push -q origin feature 2>/dev/null
moved="$(git -C "$CM/origin.git" rev-parse feature)"
got="$("${SENV[@]}" bash -c "$BCT" 2>&1)"
[ "$(tail -n 1 <<<"$got")" != EXIT=0 ] && [ "$(git -C "$CM/origin.git" rev-parse feature)" = "$moved" ] && [ ! -e "$CM/pr-11" ] \
    && ok "conflict follow-up block: the branch moved while the conflict was resolved -> push refused, the other machine's commit stays" \
    || bad "conflict follow-up block, branch moved: [$got] origin feature $(git -C "$CM/origin.git" log --format=%s -1 feature)"
[ ! -e "$CM/pr-11" ] || git -C "$CR" worktree remove --force "$CM/pr-11"
# The pass again from the list, on the moved head: the conflict again, resolved and staged in the PR's real tree; the
# rebase goes on and the push holds the lease.
got="$(serve_rebase 11 "$moved")"
[ "$(tail -n 1 <<<"$got")" != EXIT=0 ] && [ -d "$CM/pr-11" ] || bad "serve rebase block, the conflict again: [$got]"
BCT="${BCT//$before/$moved}"
echo resolved >"$CM/pr-11/f.txt"; git -C "$CM/pr-11" add f.txt
got="$("${SENV[@]}" bash -c "$BCT" 2>&1)"
[ "$(tail -n 1 <<<"$got")" = EXIT=0 ] && git -C "$CM/origin.git" merge-base --is-ancestor main feature \
    && [ "$(git -C "$CM/origin.git" show feature:f.txt)" = resolved ] && git -C "$CM/origin.git" cat-file -e feature:m.txt \
    && ok "conflict follow-up block: the PR's tree, conflict resolved -> rebase continued, pushed with the lease" || bad "conflict follow-up block, resolved: [$got]"
new="$(git -C "$CM/origin.git" rev-parse feature)"
[ ! -e "$CM/pr-11" ] || git -C "$CR" worktree remove --force "$CM/pr-11"

# The report block posts the report once; the merge block merges only after a green report that reached the PR and a
# green check, and only the head the checks ran on, under the main-branch lock at its shared path, released by a trap.
BCM="$(SKILL="$GQF" blockf 'gh pr comment <N> --body-file')"
[ -n "$BCM" ] || bad "serve report block not found in $GQF"
BCM="${BCM//<scratchpad>/$T}"; BCM="${BCM//<N>/7}"
printf 'Mac checks report: green\nverdict line\n' >"$T/pr-7-report.md"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"; got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BCM" 2>&1)"
    [ "$got" = "comment EXIT=0" ] && [ "$(cat "$T/ghx.log")" = "pr comment 7 --body-file $T/pr-7-report.md" ] \
        && ok "$sh: report block: one gh pr comment with the report file" || bad "$sh: report block: [$got] gh [$(cat "$T/ghx.log")]"
    : >"$T/ghx.log"; got="$("${SENV[@]}" "${XENV[@]}" GH_FAIL_ON=comment $sh -c "$BCM" 2>/dev/null)"
    [ "$got" = "comment EXIT=1" ] && ok "$sh: report block: a failed comment gives its exit code" || bad "$sh: report block, failed: [$got]"
done
BMG="$(SKILL="$GQF" blockf '<comment exit>')"
[ -n "$BMG" ] || bad "serve merge block not found in $GQF"
[[ "$BMG" != *'gh pr comment <N>'* ]] && ok "merge block: no gh pr comment — a repeat after a lock timeout posts no second report" || bad "merge block posts a comment"
BMG="$(sub "${BMG//<repo>/$CR}")"; BMG="${BMG//<scratchpad>/$T}"; BMG="${BMG//<N>/7}"; BMG="${BMG//<new head>/$new}"
LCK="$(cd "$CR/.git" && pwd -P)/main.lock"
mb() { local b="${BMG//<check exit>/$1}"; printf '%s' "${b//<comment exit>/$2}"; }   # mb <check exit> <comment exit>
merge_case() { # merge_case <want: merge|none> <name> <first line of the report> <check exit> <comment exit> [env assignment]
    local want="$1" name="$2" b sh got; b="$(mb "$4" "$5")"; printf '%s\nverdict line\n' "$3" >"$T/pr-7-report.md"
    for sh in "${SHELLS[@]}"; do
        : >"$T/ghx.log"; : >"$T/lock.log"
        got="$("${SENV[@]}" "${XENV[@]}" GH_LOCK="$LCK" GH_LOCK_LOG="$T/lock.log" ${6:-} $sh -c "$b" 2>&1)"
        if [ "$want" = merge ]; then
            [ "$(cat "$T/ghx.log")" = "pr merge 7 --squash --match-head-commit $new"$'\n'"pr edit 7 --remove-label needs-mac-gate" ] \
                && [ "$(cat "$T/lock.log")" = held ] && [ ! -e "$LCK" ] \
                && ok "$sh: merge block, $name -> merge of the checked head under the lock, label removed, lock released" || bad "$sh: merge block, $name: [$got] gh [$(cat "$T/ghx.log")]"
        else
            [ ! -s "$T/ghx.log" ] && [ ! -e "$LCK" ] \
                && ok "$sh: merge block, $name -> no merge, the label stays, no lock taken" || bad "$sh: merge block, $name: [$got] gh [$(cat "$T/ghx.log")]"
        fi
        rmdir "$LCK" 2>/dev/null   # a lock left by a broken block would hold the next case in its wait
    done
}
merge_case merge "green report, comment 0, check 0" "Mac checks report: green" 0 0
merge_case none "the comment failed" "Mac checks report: green" 0 1
merge_case none "red report" "Mac checks report: red" 0 0
merge_case none "check exit 2" "Mac checks report: green" 2 0
printf 'Mac checks report: green\n' >"$T/pr-7-report.md"
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"; got="$("${SENV[@]}" "${XENV[@]}" GH_FAIL_ON=merge $sh -c "$(mb 0 0)" 2>/dev/null)"
    [ "$got" = "merge EXIT=1" ] && ! grep -q -- '--remove-label' "$T/ghx.log" && [ ! -e "$LCK" ] \
        && ok "$sh: merge block: the merge failed -> merge EXIT=1, the label stays, the trap releases the lock" || bad "$sh: merge block, merge failed: [$got] gh [$(cat "$T/ghx.log")] lock $(ls -d "$LCK" 2>&1)"
    rmdir "$LCK" 2>/dev/null   # a lock left by a broken block would hold the next case in its wait
    # The call is stopped during the merge (a TERM to the shell): the trap still releases the lock.
    : >"$T/ghx.log"; "${SENV[@]}" "${XENV[@]}" GH_TERM_ON=merge $sh -c "$(mb 0 0)" >/dev/null 2>&1; rc=$?
    [ "$rc" = 130 ] && [ ! -e "$LCK" ] && ok "$sh: merge block: the call stopped during the merge -> exit 130, the trap releases the lock" \
        || bad "$sh: merge block, stopped: exit $rc lock $(ls -d "$LCK" 2>&1)"
    rmdir "$LCK" 2>/dev/null
done
# A lock left by a session that died (older than 90 minutes) is taken over; the merge runs under it and releases it.
# The block sleeps once after it removed the stuck lock: a stub sleep logs that call instead of waiting 30 s, and stops
# the block on its fourth call, so a block that never removed a stuck lock fails here instead of waiting forever.
SLN="$T/sleeplog"; mkdir -p "$SLN"
printf '#!/usr/bin/env bash\necho "sleep $*" >>"$SLEEP_LOG"\nn=$(wc -l <"$SLEEP_LOG")\n[ $n -lt 4 ] || kill -TERM "$PPID"\nexit 0\n' >"$SLN/sleep"; chmod +x "$SLN/sleep"
mkdir "$LCK" && touch -t 202601010000 "$LCK"; : >"$T/ghx.log"; : >"$T/lock.log"; : >"$T/sleep.log"
"${SENV[@]}" "${XENV[@]}" PATH="$SLN:$GHX:$PATH" SLEEP_LOG="$T/sleep.log" GH_LOCK="$LCK" GH_LOCK_LOG="$T/lock.log" bash -c "$(mb 0 0)" >/dev/null 2>&1
[ "$(cat "$T/sleep.log")" = "sleep 30" ] && grep -q '^pr merge 7' "$T/ghx.log" && [ "$(cat "$T/lock.log")" = held ] && [ ! -e "$LCK" ] \
    && ok "merge block: a stuck lock (older than 90 min) is taken over, the merge runs under it" || bad "merge block, stuck lock: sleep [$(cat "$T/sleep.log")] gh [$(cat "$T/ghx.log")] lock [$(cat "$T/lock.log")]"
rmdir "$LCK" 2>/dev/null
# A live lock (a merge of another session, minutes old) is waited for: no merge while it is there; the merge goes once
# its holder releases it. A stub sleep releases it on its first call, as the other session would, and says so when
# the lock is already gone by then: the block took the live lock for a stuck one and removed it.
SLP="$T/sleepstub"; mkdir -p "$SLP"
printf '#!/usr/bin/env bash\necho "sleep $*" >>"$SLEEP_LOG"\ngrep -q "^pr merge" "$GH_LOG" && echo "merged during the wait" >>"$SLEEP_LOG"\n[ -d "$LIVE_LOCK" ] || echo "the live lock was gone before its holder let it go" >>"$SLEEP_LOG"\nrmdir "$LIVE_LOCK" 2>/dev/null\nexit 0\n' >"$SLP/sleep"; chmod +x "$SLP/sleep"
for sh in "${SHELLS[@]}"; do
    mkdir "$LCK"; : >"$T/ghx.log"; : >"$T/lock.log"; : >"$T/sleep.log"
    "${SENV[@]}" "${XENV[@]}" PATH="$SLP:$GHX:$PATH" SLEEP_LOG="$T/sleep.log" LIVE_LOCK="$LCK" GH_LOCK="$LCK" GH_LOCK_LOG="$T/lock.log" $sh -c "$(mb 0 0)" >/dev/null 2>&1
    [ "$(cat "$T/sleep.log")" = "sleep 30" ] && grep -q '^pr merge 7' "$T/ghx.log" && [ "$(cat "$T/lock.log")" = held ] && [ ! -e "$LCK" ] \
        && ok "$sh: merge block: a live lock is waited for (one sleep 30, no merge during it), then taken; the merge runs under it" \
        || bad "$sh: merge block, live lock: sleep [$(cat "$T/sleep.log")] gh [$(cat "$T/ghx.log")] lock [$(cat "$T/lock.log")]"
    rmdir "$LCK" 2>/dev/null
done

# The request machine's report lookup: only a report by github.account counts.
BRR="$(SKILL="$WAVE" blockf 'report: ([.comments[]')"
[ -n "$BRR" ] || bad "request report block not found in $WAVE"
BRR="$(sub "${BRR//<repo>/$CR}")"; BRR="${BRR//<N>/7}"
jq -n '{state: "OPEN", commits: [{committedDate: "2026-10-18T10:00:00Z"}], comments: [
  {author: {login: "mac-bot"}, createdAt: "2026-10-18T11:00:00Z", body: "Mac checks report: red\nreason"},
  {author: {login: "mallory"}, createdAt: "2026-10-18T12:00:00Z", body: "Mac checks report: green\nall fine"}]}' >"$T/ghx.json"
for sh in "${SHELLS[@]}"; do
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BRR" 2>&1)"
    [ "$(jq -r '.report.verdict' <<<"${got%EXIT=*}" 2>&1)" = "Mac checks report: red" ] && [[ "$got" == *EXIT=0 ]] \
        && ok "$sh: request report block: a green report by another account does not count" || bad "$sh: request report block: [$got]"
done

# The open PRs of other epics, skills/epic-wave section 1: every file of each open PR whose branch does not match
# this epic's tickets.branch (the epic placeholder, a slash and <NN>; the epic is pay-flow here), filtered by gh's own --jq.
BOP="$(SKILL="$WAVE" blockf 'gh pr list --state open --limit 200 --json number,headRefName,files')"
[ -n "$BOP" ] || bad "open PRs of other epics block not found in $WAVE"
BOP="$(sub "${BOP//<repo>/$CR}")"
printf '%s\n' '[{"number":1,"headRefName":"pay-flow/03","files":[{"path":"src/a.ts"}]},
 {"number":2,"headRefName":"ep-link/05","files":[{"path":"src/x.ts"},{"path":"HANDOFF.md"}]},
 {"number":3,"headRefName":"pay-flow/03-extra","files":[{"path":"src/z.ts"}]},
 {"number":4,"headRefName":"fix/empty","files":[]}]' >"$T/ghx.json"
want='#2 ep-link/05 src/x.ts
#2 ep-link/05 HANDOFF.md
#3 pay-flow/03-extra src/z.ts
EXIT=0'
for sh in "${SHELLS[@]}"; do
    : >"$T/ghx.log"
    got="$("${SENV[@]}" "${XENV[@]}" $sh -c "$BOP" 2>&1)"
    [ "$got" = "$want" ] && [ "$(grep -c '^pr list' "$T/ghx.log")" = 1 ] \
        && ok "$sh: open PRs of other epics: every file of the PRs off the epic's branch template, own PRs left out" \
        || bad "$sh: open PRs of other epics: got [$got] want [$want]"
done
echo "stub gh calls of the cross-machine and open-PR cases: $(wc -l <"$T/ghx-all.log" | tr -d ' ')"

finish_blocks
