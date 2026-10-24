#!/usr/bin/env bash
# Tests of harness/bin/wave-gate: one `gate full` for the set of ready PRs of a wave.
# Everything runs on temporary git repositories: a bare "origin" with refs/pull/<N>/head, a clone that
# plays the orchestrator's checkout, a stub gate (counts its runs, red on a marker file, "red once",
# code 3, "nothing ran") and a stub gh (`pr merge` squash-merges into the bare origin itself, `pr view`
# answers from refs/pull). No network, no real gate, no real gh, no real /tmp/worfy-e2e.lock.
# Below — the wave-gate blocks of skills/epic-wave/SKILL.md, and its gate full block of one PR with holder.json in the
# e2e lock, cut out of the file and run under bash and zsh.
# The setup and the stubs are in wave-gate-world.sh. The other cases are split by theme, so each file stays well
# inside the per-file time limit of test/contract/harness-scripts.test.ts on a loaded machine: resume, the merges,
# the pid file and batch CI in wave-gate-merge.test.sh; the e2e lock in wave-gate-lock.test.sh; the screen and
# caffeinate in wave-gate-screen.test.sh.
# Run: bash harness/bin/tests/wave-gate.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/wave-gate-world.sh"

# --- red set: no PR outside the green prefix is marked for merge (the first test, red before the script) ---
new_world red5 1:a.txt 2:b.txt 3:RED 4:d.txt 5:e.txt
S="$W/state.json"; state "$S" null 1 2 3 4 5
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "red set: check exits 2" || bad "red set: check exit $rc: $(tail -5 "$W/out")"
[ "$(q "$S" s.status)" = red ] && ok "red set: status red" || bad "red set: status $(q "$S" s.status 2>&1)"
[ "$(q "$S" s.culprit)" = 3 ] && ok "red set: the culprit is PR 3" || bad "red set: culprit $(q "$S" s.culprit 2>&1)"
[ "$(q "$S" 's.green_prefix')" = "[1,2]" ] && ok "red set: green_prefix is PRs 1-2" || bad "red set: green_prefix $(q "$S" s.green_prefix 2>&1)"
[ "$(q "$S" s.green_tree)" = "$(q "$S" 's.prefixes[1].tree')" ] && [ -n "$(q "$S" s.green_tree)" ] \
    && ok "red set: green_tree is the tree of the prefix 1-2" || bad "red set: green_tree $(q "$S" s.green_tree 2>&1)"
# runs: the first, the repeat and the bisection — at most 2+ceil(log2 5) = 5 runs of the gate
c=$(gate_count)
[ "$c" -ge 3 ] && [ "$c" -le 5 ] && ok "red set: $c gate runs (at most 2+ceil(log2 5) = 5)" || bad "red set: $c gate runs"
[ "$(q "$S" 's.runs.filter(r=>r.role==="retry").length')" = 1 ] && [ "$(q "$S" 's.runs[1].size')" = 5 ] \
    && ok "red set: the whole set is run again before the bisection" || bad "red set: no repeat of the whole set: $(q "$S" 's.runs.map(r=>r.role+r.size)')"
grep -q "scope=all arg=full" "$GATE_DIR/log" && ! grep -qv "scope=all arg=full" "$GATE_DIR/log" \
    && ok "red set: every run is GATE_SCOPE=all gate full" || bad "red set: gate args: $(cat "$GATE_DIR/log")"
[ ! -e "$(TMPW_OF)" ] && ok "red set: the temporary worktree is removed" || bad "red set: worktree left at $(TMPW_OF)"
# merge of a red set: only the green prefix
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
merged="$(awk '$1=="pr" && $2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')"
[ "$rc" -eq 0 ] && [ "$merged" = "1 2 " ] && ok "red set: merge merges only PRs 1 and 2" || bad "red set: merge exit $rc, merged [$merged]: $(tail -3 "$W/mout")"
[ "$(git -C "$W/origin.git" rev-parse 'main^{tree}')" = "$(q "$S" s.green_tree)" ] && ok "red set: main has the tree of the green prefix" || bad "red set: main tree differs"
[ "$(q "$S" s.merge.status)" = done ] && ok "red set: merge.status done" || bad "red set: merge.status $(q "$S" s.merge.status 2>&1)"
"$WG" merge "$S" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(grep -c 'pr merge' "$GH_LOG")" = 2 ] && ok "red set: merge again merges nothing more" || bad "red set: second merge exit $rc"

# --- green set of three: base, order, heads, the tree of every prefix ----------------------
new_world green3 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && ok "green set: exit 0, status green" || bad "green set: exit $rc status $(q "$S" s.status 2>&1): $(tail -5 "$W/out")"
[ "$(q "$S" s.base)" = "$(git -C "$W/origin.git" rev-parse main)" ] && ok "green set: base is the SHA of origin/main" || bad "green set: base $(q "$S" s.base)"
[ "$(q "$S" 's.set')" = "[1,2,3]" ] && ok "green set: the set in merge order" || bad "green set: set $(q "$S" s.set)"
[ "$(q "$S" 's.prefixes.map(p=>p.head).join(" ")')" = "$(head_of 1) $(head_of 2) $(head_of 3)" ] && ok "green set: the head SHA of every PR" || bad "green set: heads"
# the tree after every prefix, built independently: main + a, + b, + c
git -C "$W/seed" checkout -q -b expect main
want=""
for n in 1 2 3; do git -C "$W/seed" merge -q --squash "pr$n" >/dev/null 2>&1 && git -C "$W/seed" commit -q -m "e$n" && want="$want $(git -C "$W/seed" rev-parse 'HEAD^{tree}')"; done
[ "$(q "$S" 's.prefixes.map(p=>" "+p.tree).join("")')" = "$want" ] && ok "green set: prefixes[i].tree equals the squash of PRs 1..i" || bad "green set: prefix trees [$(q "$S" 's.prefixes.map(p=>p.tree)')] want [$want]"
[ "$(gate_count)" = 1 ] && ok "green set: one gate run" || bad "green set: $(gate_count) gate runs"
grep -q "a.txt b.txt base.txt c.txt" "$GATE_DIR/log" && ok "green set: the gate runs on the tree of the whole set" || bad "green set: gate tree: $(cat "$GATE_DIR/log")"
[ ! -e "$(TMPW_OF)" ] && ok "green set: the temporary worktree is removed" || bad "green set: worktree left"
"$WG" check "$S" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(gate_count)" = 1 ] && ok "green set: check again on a finished state runs no gate" || bad "green set: second check exit $rc, $(gate_count) runs"
# merge of the green set
"$WG" merge "$S" >"$W/mout" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 2 3 " ] && ok "green set: merge merges 1, 2, 3 in order" || bad "green set: merge exit $rc: $(tail -3 "$W/mout")"
grep -q -- "--squash --match-head-commit $(head_of 2)" "$GH_LOG" && ok "green set: gh pr merge --squash --match-head-commit <head>" || bad "green set: gh args $(cat "$GH_LOG")"
[ "$(q "$S" 's.merge.merged.map(m=>m.tree).join(" ")')" = "$(q "$S" 's.prefixes.map(p=>p.tree).join(" ")')" ] && ok "green set: the tree of main after each merge is recorded and equal" || bad "green set: merged trees"

# --- a conflict of the second PR: DIRTY, the others are checked ------------------------------
new_world dirty 1:shared.txt=one 2:shared.txt=two 3:c.txt
S="$W/state.json"; state "$S" null 1 2 3
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,3]" ] && ok "conflict: the set is 1, 3" || bad "conflict: exit $rc set $(q "$S" s.set 2>&1): $(tail -5 "$W/out")"
[ "$(q "$S" 's.excluded.map(e=>e.number+":"+e.reason).join(" ")')" = "2:DIRTY" ] && ok "conflict: PR 2 is out of the set with DIRTY" || bad "conflict: excluded $(q "$S" s.excluded)"
grep -q "a.txt\|c.txt" "$GATE_DIR/log" && grep -q "c.txt" "$GATE_DIR/log" && ok "conflict: the gate ran on 1 + 3" || bad "conflict: gate log $(cat "$GATE_DIR/log")"
[ ! -e "$(TMPW_OF)" ] && ok "conflict: the temporary worktree is removed" || bad "conflict: worktree left"

# --- platform and needs-mac-gate: out of the set, not merged, not run ---------------------
new_world plat 1:a.txt 2:b.txt 3:c.txt 4:d.txt
S="$W/state.json"; state "$S" null 1 2,platform 3,label=needs-mac-gate 4
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,4]" ] && ok "platform: the set is 1, 4" || bad "platform: exit $rc set $(q "$S" s.set 2>&1)"
[ "$(q "$S" 's.excluded.map(e=>e.number+":"+e.reason).join(" ")')" = "2:platform 3:needs-mac-gate" ] && ok "platform: 2 platform, 3 needs-mac-gate — with the reasons" || bad "platform: excluded $(q "$S" s.excluded)"
! grep -q "b.txt\|c.txt" "$GATE_DIR/log" && ok "platform: their changes are not in the gate's tree" || bad "platform: gate tree has them: $(cat "$GATE_DIR/log")"
"$WG" merge "$S" >/dev/null 2>&1
[ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 4 " ] && ok "platform: merge merges only 1 and 4" || bad "platform: merged $(cat "$GH_LOG")"
# The label is the profile's cross_machine_gate.label from the state file, not a name in wave-gate:
# another project's label takes its PR out, worfy's name is then an ordinary label; null — no such label.
new_world xlabel 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; XLABEL='"needs-pc-gate"' state "$S" null 1 2,label=needs-pc-gate 3,label=needs-mac-gate
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,3]" ] && [ "$(q "$S" 's.excluded.map(e=>e.number+":"+e.reason).join(" ")')" = "2:needs-pc-gate" ] \
    && ok "label: the profile's label (needs-pc-gate) takes PR 2 out; needs-mac-gate is an ordinary label then" || bad "label: exit $rc set $(q "$S" s.set 2>&1) excluded $(q "$S" s.excluded 2>&1)"
new_world xlabel-null 1:a.txt 2:b.txt
S="$W/state.json"; XLABEL=null state "$S" null 1 2,label=needs-mac-gate
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,2]" ] && [ "$(q "$S" 's.excluded.length')" = 0 ] \
    && ok "label: null (no cross-machine gate in the profile) takes no PR out by a label" || bad "label null: exit $rc set $(q "$S" s.set 2>&1)"
# A state file written before the field existed has no cross_machine_label: the label is then needs-mac-gate, the one
# wave-gate used before it took the label from the profile — for check and for merge.
new_world xlabel-old 1:a.txt 2:b.txt 3:c.txt
S="$W/state.json"; state "$S" null 1 2,label=needs-mac-gate 3
node -e 'const fs=require("fs"),f=process.argv[1],s=JSON.parse(fs.readFileSync(f,"utf8"));delete s.cross_machine_label;fs.writeFileSync(f,JSON.stringify(s))' "$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.set')" = "[1,3]" ] && [ "$(q "$S" 's.excluded.map(e=>e.number+":"+e.reason).join(" ")')" = "2:needs-mac-gate" ] \
    && ok "label: an old state file without cross_machine_label — check takes the needs-mac-gate PR out" || bad "label old: exit $rc set $(q "$S" s.set 2>&1) $(cat "$W/out")"
node -e 'const fs=require("fs"),f=process.argv[1],s=JSON.parse(fs.readFileSync(f,"utf8"));delete s.cross_machine_label;fs.writeFileSync(f,JSON.stringify(s))' "$S"
"$WG" merge "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 3 " ] \
    && ok "label: an old state file without cross_machine_label — merge merges 1 and 3, not the needs-mac-gate PR" || bad "label old merge: exit $rc merged [$(cat "$GH_LOG")] $(cat "$W/out")"

# --- red, then green on the repeat: flaky ----------------------------------------------
new_world flaky 1:a.txt 2:b.txt
S="$W/state.json"; state "$S" null 1 2; touch "$GATE_DIR/redonce"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [ "$(gate_count)" = 2 ] && ok "flaky: status green after a green repeat (2 runs)" || bad "flaky: exit $rc status $(q "$S" s.status) runs $(gate_count)"
[[ "$(q "$S" s.flaky)" == *"test/e2e/flaky.spec.ts > opens the window"* && "$(q "$S" s.flaky)" == *"test:e2e"* && "$(q "$S" s.flaky)" != *"lint"* ]] && ok "flaky: the failing tests and scripts of the first run are recorded, not the passed ones" || bad "flaky: $(q "$S" s.flaky 2>&1)"

# --- could not verify: code 3 and "nothing ran" ------------------------------------------
for mode in code3 none; do
    new_world "unv-$mode" 1:a.txt 2:b.txt
    S="$W/state.json"; state "$S" null 1 2; touch "$GATE_DIR/$mode"
    "$WG" check "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" -eq 3 ] && [ "$(q "$S" s.status)" = unverified ] && [ "$(gate_count)" = 1 ] && ok "$mode: status unverified, exit 3, no repeat" || bad "$mode: exit $rc status $(q "$S" s.status 2>&1) runs $(gate_count)"
    "$WG" merge "$S" >/dev/null 2>&1; rc=$?
    [ "$rc" -ne 0 ] && [ ! -s "$GH_LOG" ] && ok "$mode: merge refuses, no gh call" || bad "$mode: merge exit $rc, gh: $(cat "$GH_LOG" 2>/dev/null)"
    [ ! -e "$(TMPW_OF)" ] && ok "$mode: the temporary worktree is removed" || bad "$mode: worktree left"
done
# a later check after an unverified run tries again
rm -f "$GATE_DIR/none"
"$WG" check "$S" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && ok "unverified: check again, now green" || bad "unverified: second check exit $rc status $(q "$S" s.status)"

# --- the Russian verdict lines of the gate of the release before --------------------------------
# shortcut: accepts the old Russian token, remove after the next release
new_world oldgreen 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/old"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && ok "old gate: the Russian green line is green" || bad "old gate green: exit $rc status $(q "$S" s.status 2>&1): $(cat "$W/out")"
new_world oldflaky 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/old" "$GATE_DIR/redonce"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && [[ "$(q "$S" s.flaky)" == *"test:e2e"* && "$(q "$S" s.flaky)" != *"lint"* ]] \
    && ok "old gate: the failed scripts are read from the Russian red line, without the passed ones" || bad "old gate red: exit $rc flaky $(q "$S" s.flaky 2>&1)"
new_world oldnone 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/old" "$GATE_DIR/none"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 3 ] && [ "$(q "$S" s.status)" = unverified ] && ok "old gate: the Russian «nothing ran» line is not green" || bad "old gate none: exit $rc status $(q "$S" s.status 2>&1)"

# --- what the verdict lines must hold to count ------------------------------------------------
# A green line of another profile is not the green of `gate full`.
new_world fastgreen 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/fastgreen"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 3 ] && [ "$(q "$S" s.status)" = unverified ] && ok "a green line of the fast profile with exit 0 is unverified, not green" || bad "fast green: exit $rc status $(q "$S" s.status 2>&1)"
# A line that mentions a red verdict in its middle is not the red line of the gate.
new_world midred 1:a.txt
S="$W/state.json"; state "$S" null 1; touch "$GATE_DIR/midred"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.flaky.scripts.join(" ")')" = test ] \
    && ok "the failed scripts come from the line that starts with the red verdict, not from a line that mentions it" || bad "mid-line red: exit $rc flaky $(q "$S" s.flaky 2>&1)"
# The words wave-gate reads are the words harness/hooks/gate.mjs prints: the stub prints lines built from the
# literals of gate.mjs, so a word renamed there and not here turns these checks red.
GATE_MJS="${GATE_MJS:-$HARNESS/hooks/gate.mjs}"
words="$(node -e '
const s = require("fs").readFileSync(process.argv[1], "utf8")
const g = s.match(/say\("\[gate\] ([^"(]+?) \(" \+ PROFILE \+ "\):" \+ ran\)/)
const r = s.match(/complain\("\[gate\] ([^"(]+?) \(" \+ PROFILE \+ "\):" \+ failedLabels/)
const p = s.match(/" \(([^":(]+):" \+ ran \+ "\)"/)
if (!g || !r || !p) process.exit(1)
process.stdout.write([g[1], r[1], p[1]].join("\n") + "\n")' "$GATE_MJS" | tr -d '\r')"; rc=$?
{ read -r GW; read -r RW; read -r PW; } <<<"$words"
[ "$rc" -eq 0 ] && [ -n "$GW" ] && [ -n "$RW" ] && [ -n "$PW" ] && ok "gate.mjs: the green, red and passed words are found ($GW, $RW, $PW)" || bad "gate.mjs: words not found (exit $rc): $words"
new_world gatewords 1:a.txt
printf 'green=%q; red=%q; passed=%q\n' "[gate] $GW" "[gate] $RW" "$PW" >"$GATE_DIR/words"
S="$W/state.json"; state "$S" null 1
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" s.status)" = green ] && ok "gate.mjs words: its green line of gate full is green" || bad "gate.mjs green: exit $rc status $(q "$S" s.status 2>&1): $(cat "$W/out")"
new_world gatewordsred 1:a.txt
printf 'green=%q; red=%q; passed=%q\n' "[gate] $GW" "[gate] $RW" "$PW" >"$GATE_DIR/words"; touch "$GATE_DIR/redonce"
S="$W/state.json"; state "$S" null 1
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(q "$S" 's.flaky.scripts.join(" ")')" = test:e2e ] \
    && ok "gate.mjs words: the failed scripts are read from its red line, without the passed ones" || bad "gate.mjs red: exit $rc flaky $(q "$S" s.flaky 2>&1)"

# --- bad input ---------------------------------------------------------------------------
new_world input 1:a.txt
S="$W/state.json"; printf '{"repo":"%s","branch":"main","prs":[]}\n' "$(tn "$W/repo")" >"$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "e2e_lock" "$W/out" && ok "input: e2e_lock missing -> exit 1 naming it" || bad "input: exit $rc $(cat "$W/out")"
printf '{"repo":"%s","branch":"main","e2e_lock":null,"prepare":null,"cross_machine_label":5,"prs":[]}\n' "$(tn "$W/repo")" >"$S"
"$WG" check "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "cross_machine_label" "$W/out" && ok "input: cross_machine_label not a string -> exit 1 naming it" || bad "input: cross_machine_label 5: exit $rc $(cat "$W/out")"
"$WG" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && ok "input: no command -> exit 1" || bad "input: no command exit $rc"

# --- the blocks of skills/epic-wave/SKILL.md, under bash and zsh -------------------------------
block() { # $1 = a string that identifies the ```bash block; prints it without the `F() {…profile…}` line
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$SKILL" \
        | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}
BI="$(block 'PLATFORM=(')"; BC="$(block 'wave-gate" check')"; BM="$(block 'wave-gate" merge')"; BCI="$(block 'wave-gate" ci')"
[ -n "$BI" ] && [ -n "$BC" ] && [ -n "$BM" ] && [ -n "$BCI" ] && ok "skill blocks: the set, check, merge and batch CI blocks are in $SKILL" || bad "skill blocks: not found in $SKILL"
for sh in "${SHELLS[@]}"; do
    new_world "skill-$sh" 1:a.txt 2:b.txt 3:c.txt
    export GH_LABELS_3="needs-mac-gate other"
    STUB="F() { case \"\$1\" in workflow.e2e_lock) echo '$(tn "$W/e2e.lock")' ;; commands.prepare_tree) echo 'echo prepared >prepared.txt' ;; cross_machine_gate.label) echo needs-mac-gate ;; *) return 4 ;; esac; }"
    # The paths the blocks hand to node in node's spelling. On Windows the set block's node, which runs gh by
    # name and would find the real gh.exe, runs the gh stand-in instead.
    sub() { local b="$1" ghpat='execFileSync("gh", ['
            b="${b//<repo>/$(tn "$W/repo")}"; b="${b//<main branch>/main}"; b="${b//<state file>/$W/state.json}"
            b="${b//<main lock>/$(tn "$W/main.lock")}"; b="${b//<PR numbers in merge order>/1 2 3}"; b="${b//<platform PR numbers>/2}"
            if on_windows; then b="${b//"$ghpat"/execFileSync(process.execPath, [\"$(node_path "$STUBS/gh.mjs")\", }"; fi
            printf '%s' "$b"; }
    # On Windows node's gh by name is the real gh.exe: a block that still names gh, other than the stand-in, is
    # not run.
    if on_windows && blk="$(sub "$BI")" && has_gh_word "${blk//"$(node_path "$STUBS/gh.mjs")"/}"; then
        bad "$sh: the set block still runs gh by name: on Windows that is the real gh, the block is not run"
    else
        got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$STUB"$'\n'"$(sub "$BI")" 2>&1)"
    fi
    S="$W/state.json"
    [ -f "$S" ] && [ "$(q "$S" 's.prs.map(p=>p.number+":"+p.platform+":"+p.labels.join("+")+":"+(p.head.length)).join(" ")')" = "1:false::40 2:true::40 3:false:needs-mac-gate+other:40" ] \
        && [ "$(q "$S" 's.repo+" "+s.branch+" "+s.e2e_lock+" "+s.prepare+" "+s.main_lock+" "+s.cross_machine_label')" = "$(tn "$W/repo") main $(tn "$W/e2e.lock") echo prepared >prepared.txt $(tn "$W/main.lock") needs-mac-gate" ] \
        && ok "$sh: the set block writes the state file" || bad "$sh: the set block: [$got] $(cat "$S" 2>/dev/null)"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$(sub "$BC")" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [ "$(q "$S" s.set)" = "[1]" ] && grep -q "prepared.txt" "$GATE_DIR/log" && ok "$sh: the check block: green set of PR 1, prepare ran" || bad "$sh: the check block: [$got]"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$(sub "$BM")" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [ "$(awk '$2=="merge"{print $3}' "$GH_LOG" | tr '\n' ' ')" = "1 " ] && ok "$sh: the merge block merges PR 1" || bad "$sh: the merge block: [$got]"
    unset GH_LABELS_3
    # The batch CI block: the profile says batch — one dispatch for main, also when the block runs twice;
    # the profile has no workflow.ci (F exits 4) — nothing is dispatched.
    BATCH_RUN='gh workflow run ci.yml --ref $ref -f job=check'; ci_guard "$BATCH_RUN"
    BATCH="F() { case \"\$1\" in workflow.ci) echo batch ;; workflow.ci_batch_run) echo '$BATCH_RUN' ;; *) return 4 ;; esac; }"
    export GH_RUN_URL="https://github.com/o/r/actions/runs/77"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$BATCH"$'\n'"$(sub "$BCI" | sed "s#<CI file>#$W/ci.json#")" 2>&1)"
    got2="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$BATCH"$'\n'"$(sub "$BCI" | sed "s#<CI file>#$W/ci.json#")" 2>&1)"
    [[ "$got" == *"EXIT=0"* ]] && [[ "$got2" == *"CI_RUN=77"* ]] && [ "$(grep -c '^workflow run ci.yml --ref main -f job=check$' "$GH_LOG")" = 1 ] \
        && ok "$sh: the batch CI block dispatches once for main, run twice" || bad "$sh: the batch CI block: [$got] [$got2] $(grep 'workflow run' "$GH_LOG")"
    got="$(cd "$W/repo" && CLAUDE_PLUGIN_ROOT="$HARNESS" $sh -c "$STUB"$'\n'"$(sub "$BCI" | sed "s#<CI file>#$W/ci-pr.json#")" 2>&1)"
    [[ "$got" == *"CI=skipped"* ]] && [[ "$got" == *"EXIT=0"* ]] && [ "$(grep -c '^workflow run' "$GH_LOG")" = 1 ] && [ "$(q "$W/ci-pr.json" s.ci)" = pr ] \
        && ok "$sh: the batch CI block without workflow.ci dispatches nothing" || bad "$sh: the CI block with pr: [$got]"
    unset GH_RUN_URL
done

# The gate full of one PR ("each"): the e2e lock with holder.json naming that PR, under bash and zsh.
BE="$(block 'printf '"'"'{"prs":[%s],"what":"gate-full"')"
[ -n "$BE" ] && ok "skill blocks: the one-PR gate full block is in $SKILL" || bad "skill blocks: the one-PR gate full block not found in $SKILL"
# The block polls the e2e lock every 20 s, and it sleeps once more after it removes an abandoned lock: the run
# with an abandoned lock below spent 20 s per shell in that sleep alone. The test runs the block with a 0.2 s
# poll, as it runs wave-gate with WAVE_GATE_LOCK_POLL_S=1; the 20 s of the block is checked here. After 50 polls
# (10 s) the block exits 98: a block that never takes the lock fails its check instead of hanging the file.
LOCK_POLL=$'\n    sleep 20\n' LOCK_FAST=$'\n    sleep 0.2; polls=$(( ${polls:-0} + 1 )); [ "$polls" -le 50 ] || exit 98\n'
[[ "$BE" == *"until mkdir \"\$L\""*"$LOCK_POLL"*"  done"* ]] && ok "skill blocks: the one-PR gate full block polls the e2e lock every 20 s" \
    || bad "skill blocks: the one-PR gate full block has no 'sleep 20' in its until mkdir loop"
# The exit code of a run of the block, for a failed check. Exit 98 is the fast poll giving up: the lock was never taken.
why() { [ "$1" = 98 ] && echo "exit 98, the lock was never taken" || echo "exit $1"; }
# run_each: one run of the block $b under $sh, its output in $got and its exit code in $rc, at most 60 s: in Git Bash
# a trap that stopped the heartbeat with kill -STOP and then killed it hung in `wait` (1 run in 7, 2 hours), and a
# run cut off by finish fails its check instead of hanging the file. A heartbeat still alive after the run (one
# deaf to every signal) is ended through Windows (kill -f) or with SIGKILL, so it outlives no test.
# A recorded pid counts as that heartbeat only while its command line carries the block ($W): pids are reused, in
# Git Bash within minutes. A run that started no heartbeat (the pid record could not be put in the block) fails too.
cmd_of() { if [ -r "/proc/$1/cmdline" ]; then tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null; else ps -ww -o command= -p "$1" 2>/dev/null; fi; }
run_each() {
    local p rb="${b/HB=\$!/HB=\$!; echo \$HB >>\"$W/hb.pids\"}"
    : >"$W/hb.pids"; $sh -c "$STUB"$'\n'"$rb" >"$W/each.out" 2>&1 &
    finish $! 60; got="$(cat "$W/each.out")"
    [ "$rb" != "$b" ] && [ -s "$W/hb.pids" ] || rc="$rc, no heartbeat pid recorded"
    for p in $(cat "$W/hb.pids"); do
        kill -0 "$p" 2>/dev/null && [[ "$(cmd_of "$p")" == *"$W"* ]] || continue
        rc="$rc, heartbeat $p left alive"
        if [ -e "/proc/$p/winpid" ]; then /usr/bin/kill -f -9 "$p" 2>/dev/null; else kill -KILL "$p" 2>/dev/null; fi
    done
}
for sh in "${SHELLS[@]}"; do
    new_world "each-$sh" 1:a.txt
    L="$W/e2e.lock"; export GATE_LOCK="$L"
    STUB="F() { case \"\$1\" in workflow.e2e_lock) echo '$L' ;; *) return 4 ;; esac; }"
    b="${BE//<N>/5}"; b="${b//<PR worktree>/$W/repo}"; b="${b//<repo>/$W/repo}"; b="${b/"$LOCK_POLL"/$LOCK_FAST}"
    b="${b//node \"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/gate.mjs\" full/$STUBS/gate full}"
    # Without the fast poll both runs below would wait the real 20 s polls, and the whole file would run out
    # of its time instead of failing this one check.
    if [[ "$b" != *"$LOCK_FAST"* ]]; then
        bad "$sh: the one-PR gate full block: the fast lock poll could not be put in place of 'sleep 20', the block is not run"
        unset GATE_LOCK; continue
    fi
    run_each
    h="$GATE_DIR/holder.1.json"
    [[ "$rc" =~ ^[0-9]+$ ]] && [[ "$got" == *"EXIT=0"* ]] && [ "$(gate_count)" = 1 ] && grep -q "lock=held" "$GATE_DIR/log" && [ "$(q "$h" 's.prs.join(",")+" "+s.what+" "+(typeof s.pid)')" = "5 gate-full number" ] \
        && ok "$sh: the one-PR gate full block: holder.json names PR 5 and gate-full while the gate runs" || bad "$sh: the one-PR block, $(why "$rc"): [$got] holder $(cat "$h" 2>/dev/null)"
    [ ! -e "$L" ] && ok "$sh: the one-PR gate full block: the lock and its holder.json are gone after it" || bad "$sh: the one-PR block left [$(ls -A "$L" 2>&1)]"
    # an abandoned lock with someone's holder.json is taken over
    mkdir "$L"; printf '{"prs":[9],"what":"gate-full","pid":1,"since":"x"}\n' >"$L/holder.json"; touch -t 202001010000 "$L"
    run_each
    [[ "$rc" =~ ^[0-9]+$ ]] && [[ "$got" == *"EXIT=0"* ]] && [ "$(q "$GATE_DIR/holder.2.json" 's.prs.join(",")' 2>&1)" = 5 ] && [ ! -e "$L" ] \
        && ok "$sh: the one-PR gate full block: an abandoned lock is removed with its holder.json and taken" || bad "$sh: the one-PR block, abandoned lock, $(why "$rc"): [$got]"
    unset GATE_LOCK
done

# --- finish: a run cut off at its time limit goes with its whole tree ---------------------------
# The run waits on a child shell, which waits on a sleep: SIGTERM to the run alone ends it and leaves both, without a
# parent, for the 30 s of the sleep. The sleep's duration names this file's process, so a pid reused by another
# process is never taken for it.
NAP="30.$$"; TREE="$T/finish-tree.pids"; : >"$TREE"
bash -c "( sleep $NAP & echo \$! >>'$TREE'; wait ) & echo \$! >>'$TREE'; wait" & run=$!
until_ok 10 eval '[ "$(wc -l <"$TREE")" -ge 2 ]' || bad "finish: the run did not start its tree: [$(cat "$TREE")]"
finish "$run" 1; why_finish="$rc"
left=; for p in $(cat "$TREE"); do kill -0 "$p" 2>/dev/null && left="$left$p "; done
[[ "$why_finish" == *"stopped by SIGTERM"* ]] && [ -z "$left" ] && ok "finish: a run cut off at its time limit is stopped with its child and grandchild" \
    || bad "finish: [$why_finish], left alive: [$left]"
for p in $left; do c="$(cmd_of "$p")"; [[ "$c" == *"$NAP"* || "$c" == *"$TREE"* ]] && kill -KILL "$p" 2>/dev/null; done

caf_gone "$T"/*/screen/caf*.log && ok "no stub caffeinate of any test is left" || bad "stub caffeinate left: $(cat "$T"/*/screen/caf*.log)"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
