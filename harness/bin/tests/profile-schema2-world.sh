# The machine of the schema 2 tests of harness/bin/profile, sourced by profile-schema2.test.sh,
# profile-attribution.test.sh and profile-user.test.sh after profile-world.sh: a temporary HOME and HARNESS_HOME with
# the registry and one profile per case, the wrappers P2 and P2NODE, the snapshot `before`, eq and fails_with.
# Not a test of its own (no .test.sh).
#
# --- schema 2 and the profile's place on the machine ---------------------------------
# Temporary HOME and HARNESS_HOME, the registry in $HARNESS_HOME/gate/config.json, no
# CLAUDE_GATE_CONFIG / CLAUDE_PROFILES_DIR: the lookup goes the way it goes on a machine.
# A profile lives in $HARNESS_HOME/projects/<name>/; a schema 1 one in ~/.claude/profiles/<name>/
# is read during the transition; with both, $HARNESS_HOME wins.
H="$T/home" HH="$T/hh"
BINREAL="$(cd "$BIN" && pwd -P)"
BINOUT="$(printed "$BINREAL")" # the bin folder as profile prints it
mkdir -p "$H/.claude/profiles" "$HH/projects" "$HH/gate" "$T/r"
for n in demo legacy both nomode badmode bare schema3 nofile absbin notobj langnum langarr langnull teamempty langblank teamnum docsempty phru phen srcs; do git -C "$T/r" init -q -b main "$n"; done
{
    printf '{"repos":['
    sep=""
    for n in demo legacy both nomode badmode bare schema3 nofile absbin notobj langnum langarr langnull teamempty langblank teamnum docsempty phru phen srcs; do printf '%s{"key":"%s","match":"%s","profile":"%s"}' "$sep" "$n" "$T/r/$n" "$n"; sep=","; done
    printf ']}\n'
} >"$HH/gate/config.json"
newp() { mkdir -p "$HH/projects/$1" && printf '%s\n' "$2" >"$HH/projects/$1/profile.json"; }
oldp() { mkdir -p "$H/.claude/profiles/$1" && printf '%s\n' "$2" >"$H/.claude/profiles/$1/profile.json"; }
# demo still names stale Harness paths: schema 2 does not take them from the file.
newp demo '{"schema":2,"name":"demo","mode":"silent","attribution":"off","language":{"reports":"ru","team":"en","docs":"ru"},"mcp":{"allowed":["qmd","worfy-canvas","github"]},"tickets":{"status_tool":"/elsewhere/ticket","epic_status":"/elsewhere/epic-status"},"workflow":{"preflight":null},"numbering":{"reserve_with":"/elsewhere/preflight"}}'
printf '# demo v2 rules\n' >"$HH/projects/demo/rules.md"
oldp legacy '{"schema":1,"name":"legacy","language":"ru","tickets":{"status_tool":"~/.claude/bin/ticket","epic_status":"~/.claude/bin/epic-status"},"workflow":{"preflight":"~/.claude/bin/preflight --epic <эпик>"},"numbering":{"reserve_with":null}}' # schema 1
newp both '{"schema":2,"name":"both","title":"from harness home","mode":"full"}'
oldp both '{"schema":1,"name":"both","title":"from legacy dir"}'
newp nomode '{"schema":2,"name":"nomode"}'
newp badmode '{"schema":2,"name":"badmode","mode":"other"}'
newp bare '{"schema":2,"name":"bare","mode":"full","language":{"reports":"en","team":"en"}}'
newp schema3 '{"schema":3,"name":"schema3","mode":"full"}'
# schema 1 with the absolute form of the old place: <HOME>/.claude/bin/<script>, spelled the way this
# OS spells it (C:\…\.claude\bin\ on Windows, escaped for JSON)
ABS_BIN="$(json_printed "$H/.claude/bin/")"
oldp absbin "{\"schema\":1,\"name\":\"absbin\",\"tickets\":{\"status_tool\":\"${ABS_BIN}ticket\"},\"workflow\":{\"preflight\":\"${ABS_BIN}preflight --epic <эпик>\"}}"
# valid JSON, but not an object
newp notobj '["schema",2]'
# language of the wrong type, and a language field that is an empty string
newp langnum '{"schema":2,"name":"langnum","mode":"full","language":5}'
newp langarr '{"schema":2,"name":"langarr","mode":"full","language":["ru"]}'
newp langnull '{"schema":2,"name":"langnull","mode":"full","language":null}'
newp teamempty '{"schema":2,"name":"teamempty","mode":"full","language":{"team":"","docs":"ru"}}'
newp langblank '{"schema":2,"name":"langblank","mode":"full","language":""}'
newp teamnum '{"schema":2,"name":"teamnum","mode":"full","language":{"team":5,"docs":"ru"}}'
# Placeholders in profile values: phen writes the English ones, phru the Russian ones of profiles written
# before the release (Russian input on purpose: profile prints them in the English form for one release).
PH_EN='"worktree":{"implementer":"git worktree add -b <branch> /w/<ticket-name> main","reviewer":"git worktree add /w/review-<review-target> --detach <branch>"},"tickets":{"branch":"<epic>/<NN>","path":".scratch/<epic>/issues/NN-*.md","spec":".scratch/<epic>/<epic>-spec.md"},"commands":{"test_one":"node --test <file>","package":{"test":"pnpm -C <package> test"}},"tests":{"new_file":{"apps/api":"<module-dir>/<name>.test.ts"}},"qmd":{"fallback_grep":[".scratch/<epic>/"]}'
PH_RU='"worktree":{"implementer":"git worktree add -b <ветка> /w/<имя-тикета> main","reviewer":"git worktree add /w/review-<что-ревьюишь> --detach <ветка>"},"tickets":{"branch":"<эпик>/<NN>","path":".scratch/<эпик>/issues/NN-*.md","spec":".scratch/<эпик>/<эпик>-spec.md"},"commands":{"test_one":"node --test <файл>","package":{"test":"pnpm -C <пакет> test"}},"tests":{"new_file":{"apps/api":"<каталог модуля>/<имя>.test.ts"}},"qmd":{"fallback_grep":[".scratch/<эпик>/"]}'
newp phen "{\"schema\":2,\"name\":\"phen\",\"mode\":\"full\",$PH_EN}"
newp phru "{\"schema\":2,\"name\":\"phru\",\"mode\":\"full\",$PH_RU}"
printf '# phru\n\n## Обязательное чтение исполнителя\n\n- docs/a.md\n\n## Ночной прогон и аудит\r\n\n- x\n\n## Ночной прогон и аудит (old)\n' >"$HH/projects/phru/rules.md"
printf '# phru\n\n## Required reading for the implementer\n\n- docs/a.md\n\n## Overnight run and audit\r\n\n- x\n\n## Ночной прогон и аудит (old)\n' >"$HH/projects/phen/rules.md"
# rules.md with a sources section in the middle under its English heading (CRLF line), another under the old
# Russian heading at the end (Russian input on purpose); the sections after the first one stay.
newp srcs '{"schema":2,"name":"srcs","mode":"full"}'
printf '# srcs\n\n## Facts\n\n- keep me\n\n## Sources\r\n\n- facts: a.md:1\n\n## After\n\n- kept too\n\n## Источники\n\n- b.md:2\n' >"$HH/projects/srcs/rules.md"
newp docsempty '{"schema":2,"name":"docsempty","mode":"full","language":{"reports":"","team":"ru","docs":""}}'
# Silent mode: a Workflow folder given with ~/, a relative one (broken), and a
# project of two repositories without workflow.folder (the folder above them).
mkdir -p "$T/r/multi"
for n in home relwf; do git -C "$T/r" init -q -b main "$n"; done
for n in m1 m2; do git -C "$T/r/multi" init -q -b main "$n"; done
jq --arg r "$T/r" '.repos += [{key: "home", match: ($r + "/home"), profile: "home"}, {key: "relwf", match: ($r + "/relwf"), profile: "relwf"},
    {key: "m1", match: ($r + "/multi/m1"), profile: "ms"}, {key: "m2", match: ($r + "/multi/m2"), profile: "ms"}]' "$HH/gate/config.json" >"$T/cfg.json" \
    && mv "$T/cfg.json" "$HH/gate/config.json"
newp home '{"schema":2,"name":"home","mode":"silent","workflow":{"folder":"~/wf"},"tickets":{"root":".scratch/"}}'
newp relwf '{"schema":2,"name":"relwf","mode":"silent","workflow":{"folder":"wf"}}'
newp ms '{"schema":2,"name":"ms","mode":"silent","workflow":{"folder":null}}'
# The default of `attribution` follows the mode: profiles that spell the value against that default.
for n in silenton fulloff; do git -C "$T/r" init -q -b main "$n"; done
jq --arg r "$T/r" '.repos += [{key: "silenton", match: ($r + "/silenton"), profile: "silenton"}, {key: "fulloff", match: ($r + "/fulloff"), profile: "fulloff"}]' \
    "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
newp silenton '{"schema":2,"name":"silenton","mode":"silent","attribution":"on"}'
newp fulloff '{"schema":2,"name":"fulloff","mode":"full","attribution":"off"}'
# `attribution` with a value that is neither "on" nor "off", one profile per value and mode: null reads as
# "not set", anything else is a broken profile. And schema 1 profiles: one that names a mode (schema 1 has
# none: it is read as Full), one with a broken value.
ATTR_BAD=(empty:'""' upper:'"OFF"' zero:0 false:false word:'"yes"')
attr_names=(silentnull fullnull legacysilent legacybad)
for v in "${ATTR_BAD[@]}"; do attr_names+=("silent${v%%:*}" "full${v%%:*}"); done
for n in "${attr_names[@]}"; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
newp silentnull '{"schema":2,"name":"silentnull","mode":"silent","attribution":null}'
newp fullnull '{"schema":2,"name":"fullnull","mode":"full","attribution":null}'
for v in "${ATTR_BAD[@]}"; do
    newp "silent${v%%:*}" "{\"schema\":2,\"name\":\"silent${v%%:*}\",\"mode\":\"silent\",\"attribution\":${v#*:}}"
    newp "full${v%%:*}" "{\"schema\":2,\"name\":\"full${v%%:*}\",\"mode\":\"full\",\"attribution\":${v#*:}}"
done
oldp legacysilent '{"schema":1,"name":"legacysilent","mode":"silent"}'
oldp legacybad '{"schema":1,"name":"legacybad","attribution":"OFF"}'
# The gate before a merge: workflow.merge_gate and workflow.e2e_lock, valid and broken values.
GATE_PROFILES=(mgwave mgeach mgnull mgbad mgnum lockrel lockhome locknum lockempty cipr cibatch cinull cibad cinorun cirunnum cirunempty)
for n in "${GATE_PROFILES[@]}"; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
newp mgwave '{"schema":2,"name":"mgwave","mode":"full","workflow":{"merge_gate":"wave","e2e_lock":"/tmp/worfy-e2e.lock"}}'
newp mgeach '{"schema":2,"name":"mgeach","mode":"full","workflow":{"merge_gate":"each","e2e_lock":null}}'
newp mgnull '{"schema":2,"name":"mgnull","mode":"full","workflow":{"merge_gate":null}}'
newp mgbad '{"schema":2,"name":"mgbad","mode":"full","workflow":{"merge_gate":"always"}}'
newp mgnum '{"schema":2,"name":"mgnum","mode":"full","workflow":{"merge_gate":1}}'
newp lockrel '{"schema":2,"name":"lockrel","mode":"full","workflow":{"e2e_lock":"tmp/e2e.lock"}}'
newp lockhome '{"schema":2,"name":"lockhome","mode":"full","workflow":{"e2e_lock":"~/e2e.lock"}}'
newp locknum '{"schema":2,"name":"locknum","mode":"full","workflow":{"e2e_lock":5}}'
newp lockempty '{"schema":2,"name":"lockempty","mode":"full","workflow":{"e2e_lock":""}}'
# Where GitHub CI runs: workflow.ci and workflow.ci_batch_run.
newp cipr '{"schema":2,"name":"cipr","mode":"full","workflow":{"ci":"pr"}}'
newp cibatch '{"schema":2,"name":"cibatch","mode":"full","workflow":{"ci":"batch","ci_batch_run":"gh workflow run ci.yml --ref $ref -f job=check"}}'
newp cinull '{"schema":2,"name":"cinull","mode":"full","workflow":{"ci":null}}'
newp cibad '{"schema":2,"name":"cibad","mode":"full","workflow":{"ci":"nightly"}}'
newp cinorun '{"schema":2,"name":"cinorun","mode":"full","workflow":{"ci":"batch"}}'
newp cirunnum '{"schema":2,"name":"cirunnum","mode":"full","workflow":{"ci":"pr","ci_batch_run":5}}'
newp cirunempty '{"schema":2,"name":"cirunempty","mode":"full","workflow":{"ci":"batch","ci_batch_run":"  "}}'
# The cross-machine gate: cross_machine_gate, valid and broken values.
CMG_PROFILES=(cmreq cmserve cmnull cmrole cmnolabel cmnosection cmservenocheck cmexemptbs cmexemptstr cmobj)
for n in "${CMG_PROFILES[@]}"; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
cmg() { newp "$1" "{\"schema\":2,\"name\":\"$1\",\"mode\":\"full\",\"cross_machine_gate\":$2}"; }
cmg cmreq '{"label": "needs-mac-gate", "role": "request", "exempt": [".scratch/", "docs/"], "checks_section": "Mac checks"}'
cmg cmserve '{"label": "needs-mac-gate", "role": "serve", "check": "GATE_SCOPE=all gate full", "checks_section": "Mac checks"}'
cmg cmnull null
cmg cmrole '{"label": "needs-mac-gate", "role": "merge", "checks_section": "Mac checks"}'
cmg cmnolabel '{"role": "request", "checks_section": "Mac checks"}'
cmg cmnosection '{"label": "needs-mac-gate", "role": "request"}'
cmg cmservenocheck '{"label": "needs-mac-gate", "role": "serve", "checks_section": "Mac checks"}'
cmg cmexemptbs '{"label": "needs-mac-gate", "role": "request", "exempt": ["docs\\\\adr\\\\"], "checks_section": "Mac checks"}'
cmg cmexemptstr '{"label": "needs-mac-gate", "role": "request", "exempt": "docs/", "checks_section": "Mac checks"}'
cmg cmobj '["needs-mac-gate"]'
# The Pipeline of the project: workflow.pipeline from the catalogue of Stage kinds. A valid one,
# null (the default), and one profile per rule it breaks: "<name>|<pipeline JSON>|<substring of the reason>".
PL_GOOD='[{"kind":"queued"},{"kind":"implementing","stuck_after":"12h"},{"kind":"ci","stuck_after":"45m"},{"kind":"agent-review","label":"Review"},{"kind":"check","name":"windows","label":"Windows"},{"kind":"check","name":"a11y"},{"kind":"gate-merge"},{"kind":"deploy","environment":"stable"},{"kind":"closing"},{"kind":"done"}]'
PL_BAD=(
    'plobj|{"kind":"queued"}|workflow.pipeline is a list'
    'plempty|[]|workflow.pipeline is a list of Stage kinds, got an empty list'
    'plitem|[{"kind":"queued"},"ci",{"kind":"done"}]|workflow.pipeline[1] is an object'
    'plkind|[{"kind":"queued"},{"kind":"review"},{"kind":"done"}]|workflow.pipeline[1].kind "review" is not a Stage kind'
    'plnokind|[{"kind":"queued"},{"label":"x"},{"kind":"done"}]|workflow.pipeline[1].kind'
    'plkey|[{"kind":"queued"},{"kind":"ci","when":"always"},{"kind":"done"}]|workflow.pipeline[1] has an unknown field "when"'
    'plfirst|[{"kind":"implementing"},{"kind":"queued"},{"kind":"done"}]|the first Stage is queued'
    'pllast|[{"kind":"queued"},{"kind":"done"},{"kind":"closing"}]|the last Stage is done'
    'pldup|[{"kind":"queued"},{"kind":"ci"},{"kind":"ci"},{"kind":"done"}]|"ci" more than once'
    'plcheckdup|[{"kind":"queued"},{"kind":"check","name":"windows"},{"kind":"check","name":"windows"},{"kind":"done"}]|check "windows" more than once'
    'plchecknoname|[{"kind":"queued"},{"kind":"check"},{"kind":"done"}]|workflow.pipeline[1]: check needs a name'
    'plcheckbadname|[{"kind":"queued"},{"kind":"check","name":"Win dows"},{"kind":"done"}]|workflow.pipeline[1].name'
    'plname|[{"kind":"queued"},{"kind":"ci","name":"x"},{"kind":"done"}]|workflow.pipeline[1]: name is only for check'
    'plenv|[{"kind":"queued"},{"kind":"ci","environment":"prod"},{"kind":"done"}]|workflow.pipeline[1]: environment is only for deploy'
    'plboth|[{"kind":"queued"},{"kind":"gate-merge"},{"kind":"awaiting-merge"},{"kind":"done"}]|gate-merge and awaiting-merge'
    'plstuck|[{"kind":"queued"},{"kind":"ci","stuck_after":"2 days"},{"kind":"done"}]|workflow.pipeline[1].stuck_after is "<number>h" or "<number>m"'
    'plstucknum|[{"kind":"queued"},{"kind":"ci","stuck_after":2},{"kind":"done"}]|workflow.pipeline[1].stuck_after'
    'plstuckzero|[{"kind":"queued"},{"kind":"ci","stuck_after":"0h"},{"kind":"done"}]|workflow.pipeline[1].stuck_after'
    'pllabel|[{"kind":"queued"},{"kind":"ci","label":""},{"kind":"done"}]|workflow.pipeline[1].label'
)
for n in plgood plnull; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
newp plgood "{\"schema\":2,\"name\":\"plgood\",\"mode\":\"full\",\"workflow\":{\"pipeline\":$PL_GOOD}}"
newp plnull '{"schema":2,"name":"plnull","mode":"full","workflow":{"pipeline":null}}'
for spec in "${PL_BAD[@]}"; do
    n="${spec%%|*}"; rest="${spec#*|}"; pl="${rest%|*}"
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
    newp "$n" "{\"schema\":2,\"name\":\"$n\",\"mode\":\"full\",\"workflow\":{\"pipeline\":$pl}}"
done
# The names of the document sections code parses: tickets.done_section, tickets.manual_mark and
# docs.adr_status_label (tickets.trail_section stays as written: null there means "no such section").
# Values of a project whose documents are not in English, nulls (the defaults), null groups, and one
# malformed value per field.
HD_PROFILES=(hdset hdnull hdgroupsnull hddonenum hddoneempty hdmanuallist hdstatusnum fpset fpnull fpabs fpdots fpnum fpblank fplist fpempty fpfalse fpzero fpobj)
for n in "${HD_PROFILES[@]}"; do
    git -C "$T/r" init -q -b main "$n"
    jq --arg m "$T/r/$n" --arg n "$n" '.repos += [{key: $n, match: $m, profile: $n}]' "$HH/gate/config.json" >"$T/cfg.json" && mv "$T/cfg.json" "$HH/gate/config.json"
done
hd() { newp "$1" "{\"schema\":2,\"name\":\"$1\",\"mode\":\"full\",$2}"; }
hd hdset '"tickets":{"trail_section":"## Fichiers","done_section":"## Fini quand","manual_mark":"à la main"},"docs":{"adr_dir":"docs/adr","adr_status_label":"Statut"}'
hd hdnull '"tickets":{"trail_section":null,"done_section":null,"manual_mark":null},"docs":{"adr_status_label":null}'
hd hdgroupsnull '"tickets":null,"docs":null'
hd hddonenum '"tickets":{"done_section":5}'
hd hddoneempty '"tickets":{"done_section":"  "}'
hd hdmanuallist '"tickets":{"manual_mark":["manual"]}'
hd hdstatusnum '"docs":{"adr_status_label":1}'
# docs.feature_pages: the optional folder of feature pages: a path, null and one malformed value per kind.
hd fpset '"docs":{"adr_dir":"docs/adr","feature_pages":"docs/pages"}'
hd fpnull '"docs":{"feature_pages":null}'
hd fpabs '"docs":{"feature_pages":"/abs/pages"}'
hd fpdots '"docs":{"feature_pages":"../../pages"}'
hd fpnum '"docs":{"adr_dir":"docs/adr","feature_pages":5}'
hd fpblank '"docs":{"feature_pages":"  "}'
hd fplist '"docs":{"feature_pages":["docs/pages"]}'
hd fpempty '"docs":{"feature_pages":""}'
hd fpfalse '"docs":{"feature_pages":false}'
hd fpzero '"docs":{"feature_pages":0}'
hd fpobj '"docs":{"feature_pages":{"dir":"docs/pages"}}'
cat >"$T/p2" <<EOF
#!/usr/bin/env bash
exec env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR HOME="$H" USERPROFILE="$H" HARNESS_HOME="$HH" "$PROFILE" "\$@"
EOF
chmod +x "$T/p2"
P2="$T/p2"
# The same as a node script: ticket starts it with its own node (process.execPath), so it runs on Windows
# too, where node cannot start a shell script. Paths in node's spelling, escaped for a JS string.
cat >"$T/p2node" <<EOF
#!/usr/bin/env node
const env = { ...process.env, HOME: "$(json_printed "$H")", USERPROFILE: "$(json_printed "$H")", HARNESS_HOME: "$(json_printed "$HH")" }
delete env.CLAUDE_GATE_CONFIG
delete env.CLAUDE_PROFILES_DIR
const r = require("child_process").spawnSync(process.execPath, ["$(json_printed "$PROFILE")", ...process.argv.slice(2)], { env, stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
chmod +x "$T/p2node"
P2NODE="$T/p2node"
snapshot() { find "$H" "$HH" | LC_ALL=C sort && find "$H" "$HH" -type f -exec cksum {} + | LC_ALL=C sort; }
before="$(snapshot)"
eq() { # $1 name, $2 expected stdout exactly, then the command (exit code must be 0)
    local name="$1" want="$2"
    shift 2
    check "$name" 0 "" bash -c 'got="$("$@")" && [ "$got" = "$0" ]' "$want" "$@"
}
fails_with() { # $1 name, $2 exit code, $3 substring of stderr, then the command
    local name="$1" rc="$2" sub="$3"
    shift 3
    check "$name" 0 "" bash -c 'e="$("${@:2}" 2>&1 >/dev/null)"; r=$?; [ "$r" -eq "$0" ] && [[ "$e" == *"$1"* ]]' "$rc" "$sub" "$@"
}
