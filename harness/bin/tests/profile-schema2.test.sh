#!/usr/bin/env bash
# Tests of harness/bin/profile: schema 2 and the profile's place on the machine, the default of attribution,
# workflow.merge_gate, workflow.e2e_lock, workflow.ci, cross_machine_gate, the names of the document sections and
# workflow.pipeline. The machine is profile-schema2-world.sh: a temporary HOME and HARNESS_HOME.
# Run: bash harness/bin/tests/profile-schema2.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/profile-world.sh"
. "$HERE/profile-schema2-world.sh"

eq "schema 2: in HARNESS_HOME/projects: --name" demo "$P2" -C "$T/r/demo" --name
eq "schema 2: in HARNESS_HOME/projects: --dir" "$(printed "$HH/projects/demo")" "$P2" -C "$T/r/demo" --dir
eq "schema 2: in HARNESS_HOME/projects: _resolved.dir" "$(printed "$HH/projects/demo")" "$P2" -C "$T/r/demo" --field _resolved.dir
eq "schema 2: --field mode from the file" silent "$P2" -C "$T/r/demo" --field mode
eq "schema 2: --rules from HARNESS_HOME" "# demo v2 rules" "$P2" -C "$T/r/demo" --rules
eq "schema 1: only in ~/.claude/profiles: --name" legacy "$P2" -C "$T/r/legacy" --name
eq "schema 1: only in ~/.claude/profiles: --dir" "$(printed "$H/.claude/profiles/legacy")" "$P2" -C "$T/r/legacy" --dir
eq "in both places: HARNESS_HOME wins (--dir)" "$(printed "$HH/projects/both")" "$P2" -C "$T/r/both" --dir
eq "in both places: HARNESS_HOME wins (field)" "from harness home" "$P2" -C "$T/r/both" --field title
fails_with "schema 2: without mode -> 1 with the reason" 1 '"mode"' "$P2" -C "$T/r/nomode" --name
fails_with "schema 2: with mode other -> 1 with the reason" 1 '"other"' "$P2" -C "$T/r/badmode" --field schema
fails_with "unknown schema 3 -> 1 with the reason" 1 'schema' "$P2" -C "$T/r/schema3" --name
fails_with "profile in neither place -> 3 naming both" 3 "$(printed "$HH/projects/nofile/profile.json")" "$P2" -C "$T/r/nofile" --name
eq "schema 1: --field mode -> full" full "$P2" -C "$T/r/legacy" --field mode
# `attribution` absent: the default follows the mode — `off` in Silent mode, `on` in Full mode (schema 1 is
# always Full). A value written in the file wins in both modes. --json carries the same resolved value.
attr_json=(bash -c 'set -o pipefail; "$@" --json | jq -r .attribution' _ "$P2" -C)
eq "--field attribution absent, Full mode -> on (schema 2)" on "$P2" -C "$T/r/bare" --field attribution
eq "--field attribution absent -> on (schema 1)" on "$P2" -C "$T/r/legacy" --field attribution
eq "--field attribution absent, Silent mode -> off" off "$P2" -C "$T/r/home" --field attribution
eq "--field attribution from the file" off "$P2" -C "$T/r/demo" --field attribution
eq "--field attribution: an explicit on in Silent mode wins" on "$P2" -C "$T/r/silenton" --field attribution
eq "--field attribution: an explicit off in Full mode wins" off "$P2" -C "$T/r/fulloff" --field attribution
eq "--json attribution absent, Full mode -> on" on "${attr_json[@]}" "$T/r/bare"
eq "--json attribution absent (schema 1) -> on" on "${attr_json[@]}" "$T/r/legacy"
# --- workflow.merge_gate and workflow.e2e_lock ---------------------------------
eq "--field workflow.merge_gate wave" wave "$P2" -C "$T/r/mgwave" --field workflow.merge_gate
eq "--field workflow.merge_gate each" each "$P2" -C "$T/r/mgeach" --field workflow.merge_gate
eq "--field workflow.merge_gate null" null "$P2" -C "$T/r/mgnull" --field workflow.merge_gate
check "--field workflow.merge_gate absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field workflow.merge_gate
fails_with "workflow.merge_gate \"always\" -> 1 with the reason" 1 'workflow.merge_gate is "each", "wave" or null, got "always"' "$P2" -C "$T/r/mgbad" --name
fails_with "workflow.merge_gate 1 -> 1 with the reason" 1 "workflow.merge_gate" "$P2" -C "$T/r/mgnum" --field workflow
eq "--field workflow.e2e_lock path" /tmp/worfy-e2e.lock "$P2" -C "$T/r/mgwave" --field workflow.e2e_lock
eq "--field workflow.e2e_lock null" null "$P2" -C "$T/r/mgeach" --field workflow.e2e_lock
check "--field workflow.e2e_lock absent -> 4" 4 "" "$P2" -C "$T/r/mgnull" --field workflow.e2e_lock
eq "--field workflow.e2e_lock with ~/ is expanded" "$(printed "$H/e2e.lock")" "$P2" -C "$T/r/lockhome" --field workflow.e2e_lock
fails_with "workflow.e2e_lock relative -> 1 with the reason" 1 "workflow.e2e_lock is an absolute path or null" "$P2" -C "$T/r/lockrel" --name
fails_with "workflow.e2e_lock 5 -> 1 with the reason" 1 "workflow.e2e_lock" "$P2" -C "$T/r/locknum" --name
fails_with "workflow.e2e_lock empty -> 1 with the reason" 1 "workflow.e2e_lock" "$P2" -C "$T/r/lockempty" --name
eq "--json carries workflow.merge_gate" wave bash -c 'set -o pipefail; "$@" --json | jq -r .workflow.merge_gate' _ "$P2" -C "$T/r/mgwave"
# --- workflow.ci and workflow.ci_batch_run --------------------------------------------------------
eq "--field workflow.ci absent -> pr" pr "$P2" -C "$T/r/mgwave" --field workflow.ci
eq "--field workflow.ci null -> pr" pr "$P2" -C "$T/r/cinull" --field workflow.ci
eq "--field workflow.ci pr" pr "$P2" -C "$T/r/cipr" --field workflow.ci
eq "--field workflow.ci batch" batch "$P2" -C "$T/r/cibatch" --field workflow.ci
eq "--field workflow.ci_batch_run as written" 'gh workflow run ci.yml --ref $ref -f job=check' "$P2" -C "$T/r/cibatch" --field workflow.ci_batch_run
eq "--json carries the resolved workflow.ci" pr bash -c 'set -o pipefail; "$@" --json | jq -r .workflow.ci' _ "$P2" -C "$T/r/mgwave"
check "--field workflow.ci_batch_run absent -> 4" 4 "" "$P2" -C "$T/r/cipr" --field workflow.ci_batch_run
fails_with "workflow.ci \"nightly\" -> 1 with the reason" 1 'workflow.ci is "pr", "batch" or null, got "nightly"' "$P2" -C "$T/r/cibad" --name
fails_with "workflow.ci batch without ci_batch_run -> 1 with the reason" 1 'workflow.ci "batch" needs workflow.ci_batch_run' "$P2" -C "$T/r/cinorun" --name
fails_with "workflow.ci batch with a blank ci_batch_run -> 1" 1 'workflow.ci "batch" needs workflow.ci_batch_run' "$P2" -C "$T/r/cirunempty" --name
fails_with "workflow.ci_batch_run 5 -> 1 with the reason" 1 'workflow.ci_batch_run is a command string or null' "$P2" -C "$T/r/cirunnum" --name
# --- cross_machine_gate -------------------------------------------------------------------------------------------
eq "--field cross_machine_gate.role request" request "$P2" -C "$T/r/cmreq" --field cross_machine_gate.role
eq "--field cross_machine_gate.label" needs-mac-gate "$P2" -C "$T/r/cmreq" --field cross_machine_gate.label
eq "--field cross_machine_gate.checks_section" "Mac checks" "$P2" -C "$T/r/cmreq" --field cross_machine_gate.checks_section
eq "--field cross_machine_gate.exempt: one path a line, as the label block of ship-ticket reads it" $'.scratch/\ndocs/' \
    bash -c 'set -o pipefail; "$@" | sed -n '"'"'s/^ *"\(.*\)",\{0,1\}$/\1/p'"'" _ "$P2" -C "$T/r/cmreq" --field cross_machine_gate.exempt
eq "--field cross_machine_gate.role serve" serve "$P2" -C "$T/r/cmserve" --field cross_machine_gate.role
eq "--field cross_machine_gate.check with serve" "GATE_SCOPE=all gate full" "$P2" -C "$T/r/cmserve" --field cross_machine_gate.check
check "--field cross_machine_gate absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field cross_machine_gate
check "--field cross_machine_gate.role absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field cross_machine_gate.role
check "--field cross_machine_gate.exempt absent with serve -> 4" 4 "" "$P2" -C "$T/r/cmserve" --field cross_machine_gate.exempt
eq "--field cross_machine_gate null" null "$P2" -C "$T/r/cmnull" --field cross_machine_gate
check "--field cross_machine_gate.role under null -> 4" 4 "" "$P2" -C "$T/r/cmnull" --field cross_machine_gate.role
fails_with "cross_machine_gate.role \"merge\" -> 1 with the reason" 1 'cross_machine_gate.role is "request" or "serve", got "merge"' "$P2" -C "$T/r/cmrole" --name
fails_with "cross_machine_gate without label -> 1 with the reason" 1 'cross_machine_gate.label is the name of the GitHub label, got no label' "$P2" -C "$T/r/cmnolabel" --name
fails_with "cross_machine_gate without checks_section -> 1 with the reason" 1 'cross_machine_gate.checks_section is the heading' "$P2" -C "$T/r/cmnosection" --name
fails_with "cross_machine_gate serve without check -> 1 with the reason" 1 'cross_machine_gate: role "serve" needs check' "$P2" -C "$T/r/cmservenocheck" --name
fails_with "cross_machine_gate.exempt with a backslash -> 1 with the reason" 1 'cross_machine_gate.exempt is a list of paths' "$P2" -C "$T/r/cmexemptbs" --name
fails_with "cross_machine_gate.exempt a string -> 1 with the reason" 1 'cross_machine_gate.exempt is a list of paths' "$P2" -C "$T/r/cmexemptstr" --name
fails_with "cross_machine_gate a list -> 1 with the reason" 1 'cross_machine_gate is an object' "$P2" -C "$T/r/cmobj" --field cross_machine_gate
# --- the names of the document sections code parses -------------------------------------------
eq "--field tickets.trail_section as written" "## Fichiers" "$P2" -C "$T/r/hdset" --field tickets.trail_section
eq "--field tickets.done_section as written" "## Fini quand" "$P2" -C "$T/r/hdset" --field tickets.done_section
eq "--field tickets.manual_mark as written" "à la main" "$P2" -C "$T/r/hdset" --field tickets.manual_mark
eq "--field docs.adr_status_label as written" "Statut" "$P2" -C "$T/r/hdset" --field docs.adr_status_label
eq "--field docs.adr_dir is kept beside the label" "docs/adr" "$P2" -C "$T/r/hdset" --field docs.adr_dir
# trail_section has no default: null says the tickets have no file-list section, and skills skip that step.
eq "--field tickets.trail_section null stays null" null "$P2" -C "$T/r/hdnull" --field tickets.trail_section
check "--field tickets.trail_section absent -> 4" 4 "" "$P2" -C "$T/r/bare" --field tickets.trail_section
for p in bare hdnull hdgroupsnull legacy; do
    eq "$p: tickets.done_section absent or null -> ## Done when" "## Done when" "$P2" -C "$T/r/$p" --field tickets.done_section
    eq "$p: tickets.manual_mark absent or null -> manual" manual "$P2" -C "$T/r/$p" --field tickets.manual_mark
    eq "$p: docs.adr_status_label absent or null -> Status" Status "$P2" -C "$T/r/$p" --field docs.adr_status_label
done
eq "--json carries the three names, resolved" $'## Done when\nmanual\nStatus' \
    bash -c 'set -o pipefail; "$@" --json | jq -r ".tickets.done_section, .tickets.manual_mark, .docs.adr_status_label" | tr -d "\r"' _ "$P2" -C "$T/r/bare"
# A malformed value is one warning on stderr, with the profile's path, and the default: the project is still read.
for spec in "hddonenum|tickets.done_section|## Done when|got 5" "hddoneempty|tickets.done_section|## Done when|got \"  \"" \
    "hdmanuallist|tickets.manual_mark|manual|got [\"manual\"]" "hdstatusnum|docs.adr_status_label|Status|got 1"; do
    IFS='|' read -r p f want got <<<"$spec"
    eq "$p: a malformed $f -> the default" "$want" "$P2" -C "$T/r/$p" --field "$f"
    fails_with "$p: a malformed $f -> exit 0 and one warning with the path" 0 "profile: $(printed "$HH/projects/$p/profile.json"): $f must be a non-empty string or null, $got — ignored" "$P2" -C "$T/r/$p" --name
done
# --- docs.feature_pages -------------------------------------------------------------------------
eq "--field docs.feature_pages as written" "docs/pages" "$P2" -C "$T/r/fpset" --field docs.feature_pages
eq "--field docs.feature_pages null stays null" null "$P2" -C "$T/r/fpnull" --field docs.feature_pages
# No field: the skills skip the step on exit 4, and the profile reads as before, with no warning.
for p in bare hdgroupsnull legacy; do
    check "$p: docs.feature_pages absent -> 4" 4 "" "$P2" -C "$T/r/$p" --field docs.feature_pages
    eq "$p: --json has no docs.feature_pages" false bash -c 'set -o pipefail; "$@" --json | jq ".docs | has(\"feature_pages\")" | tr -d "\r"' _ "$P2" -C "$T/r/$p"
    eq "$p: no field, no warning" "" bash -c '"$@" 2>&1 >/dev/null | grep -F feature_pages || true' _ "$P2" -C "$T/r/$p" --name
done
# A malformed value is one warning with the profile's path, and the field reads as absent: the project is still read.
for spec in "fpnum|got 5" "fpblank|got \"  \"" "fplist|got [\"docs/pages\"]"; do
    p="${spec%%|*}" got="${spec#*|}"
    check "$p: a malformed docs.feature_pages -> 4, as absent" 4 "" "$P2" -C "$T/r/$p" --field docs.feature_pages
    fails_with "$p: a malformed docs.feature_pages -> exit 0 and one warning with the path" 0 "profile: $(printed "$HH/projects/$p/profile.json"): docs.feature_pages must be a non-empty path or null, $got — ignored" "$P2" -C "$T/r/$p" --name
done
eq "a malformed docs.feature_pages leaves the rest of docs" "docs/adr" "$P2" -C "$T/r/fpnum" --field docs.adr_dir
# --- workflow.pipeline ------------------------------------------------------------------------
PL_DEFAULT='[{"kind":"queued"},{"kind":"implementing"},{"kind":"ci"},{"kind":"agent-review"},{"kind":"gate-merge"},{"kind":"closing"},{"kind":"done"}]'
eq "no workflow.pipeline -> _resolved.pipeline is the default Pipeline" "$PL_DEFAULT" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/bare" --field _resolved.pipeline
eq "workflow.pipeline null -> the default Pipeline" "$PL_DEFAULT" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/plnull" --field _resolved.pipeline
eq "schema 1 -> the default Pipeline" "$PL_DEFAULT" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/legacy" --field _resolved.pipeline
eq "a valid workflow.pipeline -> _resolved.pipeline is that Pipeline" "$(jq -c . <<<"$PL_GOOD")" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/plgood" --field _resolved.pipeline
eq "a valid workflow.pipeline: --field workflow.pipeline as written" "$(jq -c . <<<"$PL_GOOD")" bash -c 'set -o pipefail; "$@" | jq -c .' _ "$P2" -C "$T/r/plgood" --field workflow.pipeline
eq "--json carries _resolved.pipeline" "queued implementing ci agent-review gate-merge closing done" bash -c 'set -o pipefail; "$@" --json | jq -r "[._resolved.pipeline[].kind] | join(\" \")"' _ "$P2" -C "$T/r/bare"
check "the default Pipeline is not written into workflow" 4 "" "$P2" -C "$T/r/bare" --field workflow.pipeline
for spec in "${PL_BAD[@]}"; do
    n="${spec%%|*}"; reason="${spec##*|}"
    fails_with "workflow.pipeline ($n) -> 1: $reason" 1 "$reason" "$P2" -C "$T/r/$n" --name
done
fails_with "a broken workflow.pipeline names the profile and says broken profile" 1 "$(printed "$HH/projects/pldup/profile.json"): workflow.pipeline" "$P2" -C "$T/r/pldup" --name
fails_with "a broken workflow.pipeline: broken profile" 1 "— broken profile" "$P2" -C "$T/r/plfirst" --name

after="$(snapshot)"
check "profile writes nothing into HOME or HARNESS_HOME" 0 "" test "$before" = "$after"

home_after="$(real_home_snapshot "$REAL_HOME")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" 0 "" test "$home_before" = "$home_after"
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
