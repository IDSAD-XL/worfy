#!/usr/bin/env bash
# Tests of harness/bin/profile: the user's personalization ($HARNESS_HOME/user.json) and the languages of a profile,
# CLAUDE_PROFILES_DIR, and Silent mode (_resolved.mode, the Workflow folder, the repositories, tickets.root). The
# machine is profile-schema2-world.sh: a temporary HOME and HARNESS_HOME.
# Run: bash harness/bin/tests/profile-user.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/profile-world.sh"
. "$HERE/profile-schema2-world.sh"

# --- User personalization: $HARNESS_HOME/user.json -------------------------------------------------
# language.reports comes from the user's file first, then (for one release) from the profile, then en.
# language.team and language.docs stay in the profile; unset they are en. A broken user.json is one line
# on stderr and the next value in that order, never a failure. Each case has its own Harness state
# folder; the registry and the profiles are the ones above.
# pu <Harness state folder> <profile arguments…>
cat >"$T/pu" <<EOF
#!/usr/bin/env bash
hu="\$1"
shift
exec env CLAUDE_GATE_CONFIG="$HH/gate/config.json" CLAUDE_PROFILES_DIR="$HH/projects" HOME="$H" USERPROFILE="$H" HARNESS_HOME="\$hu" "$PROFILE" "\$@"
EOF
chmod +x "$T/pu"
pu="$T/pu"
uj() { mkdir -p "$T/u/$1" && printf '%s' "$2" >"$T/u/$1/user.json"; } # $1 case, $2 the file's text
mkdir -p "$T/u/none"
uj ru '{"language":{"reports":"ru","team":"de","docs":"de"}}'
uj notjson '{"language":'
uj array '["ru"]'
uj numeric '{"language":{"reports":5}}'
uj empty '{}'
uj blank ''
mkdir -p "$T/u/bom" && printf '\357\273\277%s' '{"language":{"reports":"ru"}}' >"$T/u/bom/user.json" # PowerShell 5 Set-Content -Encoding UTF8
eq "user.json ru, profile en -> ru" ru "$pu" "$T/u/ru" -C "$T/r/bare" --field language.reports
eq "user.json ru, profile without language -> ru" ru "$pu" "$T/u/ru" -C "$T/r/both" --field language.reports
eq "user.json does not set language.team (profile en)" en "$pu" "$T/u/ru" -C "$T/r/bare" --field language.team
eq "user.json does not set language.docs (profile ru)" ru "$pu" "$T/u/ru" -C "$T/r/demo" --field language.docs
check "user.json ru: the summary shows reports ru" 0 '"reports": "ru"' "$pu" "$T/u/ru" -C "$T/r/bare"
check "user.json ru: --json shows reports ru" 0 '"reports": "ru"' "$pu" "$T/u/ru" -C "$T/r/bare" --json
eq "no user.json -> the profile's language.reports (ru)" ru "$pu" "$T/u/none" -C "$T/r/demo" --field language.reports
eq "no user.json -> the profile's language.reports (en)" en "$pu" "$T/u/none" -C "$T/r/bare" --field language.reports
eq "no user.json, no language in the profile -> reports en" en "$pu" "$T/u/none" -C "$T/r/both" --field language.reports
eq "no language in the profile -> team en" en "$pu" "$T/u/none" -C "$T/r/both" --field language.team
eq "no language in the profile -> docs en" en "$pu" "$T/u/none" -C "$T/r/both" --field language.docs
eq "profile without language.docs -> docs en" en "$pu" "$T/u/none" -C "$T/r/bare" --field language.docs
eq "user.json {} -> the profile's value" ru "$pu" "$T/u/empty" -C "$T/r/demo" --field language.reports
check "user.json {}: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/empty" -C "$T/r/demo" --field language.reports
check "no user.json: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/none" -C "$T/r/demo" --field language.reports
eq "user.json with a byte order mark is read -> ru" ru "$pu" "$T/u/bom" -C "$T/r/bare" --field language.reports
check "user.json with a byte order mark: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/bom" -C "$T/r/bare" --field language.reports
eq "empty user.json -> the profile's value" ru "$pu" "$T/u/blank" -C "$T/r/demo" --field language.reports
check "empty user.json: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/blank" -C "$T/r/demo" --field language.reports
for c in notjson array numeric; do
    eq "broken user.json ($c), no language in the profile -> en, exit 0" en "$pu" "$T/u/$c" -C "$T/r/both" --field language.reports
    eq "broken user.json ($c), profile ru -> ru" ru "$pu" "$T/u/$c" -C "$T/r/demo" --field language.reports
    check "broken user.json ($c): one stderr line naming the file" 0 "" bash -c \
        'e="$("${@:2}" 2>&1 >/dev/null)"; [ "$(printf "%s\n" "$e" | wc -l | tr -d " ")" = 1 ] && [[ "$e" == *"$1"* ]]' \
        _ "$(printed "$T/u/$c/user.json")" "$pu" "$T/u/$c" -C "$T/r/both" --field language.reports
done
# A profile language that is not an object (a number, an array, null) or a language field that is not a
# non-empty string: the value is en and one stderr line names the profile file, as for a broken user.json.
one_line_naming() { # $1 the text the stderr line must name, then the command
    check "$2" 0 "" bash -c 'e="$("${@:2}" 2>&1 >/dev/null)"; [ "$(printf "%s\n" "$e" | wc -l | tr -d " ")" = 1 ] && [ -n "$e" ] && [[ "$e" == *"$1"* ]]' _ "$1" "${@:3}"
}
for c in langnum langarr langnull; do
    for k in reports team docs; do
        eq "profile language not an object ($c) -> $k en" en "$pu" "$T/u/none" -C "$T/r/$c" --field "language.$k"
    done
    one_line_naming "$(printed "$HH/projects/$c/profile.json")" "profile language not an object ($c): one stderr line naming the profile" \
        "$pu" "$T/u/none" -C "$T/r/$c" --field language.team
done
check "profile without language: nothing on stderr" 0 "" bash -c '[ -z "$("$@" 2>&1 >/dev/null)" ]' _ "$pu" "$T/u/none" -C "$T/r/both" --field language.team
eq "profile language.team \"\" -> en" en "$pu" "$T/u/none" -C "$T/r/teamempty" --field language.team
eq "profile language.team \"\": docs stays ru" ru "$pu" "$T/u/none" -C "$T/r/teamempty" --field language.docs
one_line_naming "$(printed "$HH/projects/teamempty/profile.json")" "profile language.team \"\": one stderr line naming the profile" \
    "$pu" "$T/u/none" -C "$T/r/teamempty" --field language.team
check "profile language.team \"\": the stderr line names the field" 0 "" bash -c '[[ "$("$@" 2>&1 >/dev/null)" == *language.team* ]]' _ "$pu" "$T/u/none" -C "$T/r/teamempty" --field language.team
# The old string form, empty: one line for the whole field, not one per expanded field.
for k in reports team docs; do
    eq "profile language \"\" -> $k en" en "$pu" "$T/u/none" -C "$T/r/langblank" --field "language.$k"
done
one_line_naming "$(printed "$HH/projects/langblank/profile.json")" "profile language \"\": one stderr line naming the profile" \
    "$pu" "$T/u/none" -C "$T/r/langblank" --field language.team
# A field of another type, and the fields other than team.
eq "profile language.team 5 -> en" en "$pu" "$T/u/none" -C "$T/r/teamnum" --field language.team
one_line_naming "$(printed "$HH/projects/teamnum/profile.json")" "profile language.team 5: one stderr line naming the profile" \
    "$pu" "$T/u/none" -C "$T/r/teamnum" --field language.team
eq "profile language.docs \"\" -> en" en "$pu" "$T/u/none" -C "$T/r/docsempty" --field language.docs
eq "profile language.reports \"\" -> en" en "$pu" "$T/u/none" -C "$T/r/docsempty" --field language.reports
eq "profile language.reports and docs \"\": team stays ru" ru "$pu" "$T/u/none" -C "$T/r/docsempty" --field language.team
check "profile language.reports and docs \"\": one stderr line for each, naming the field" 0 "" bash -c \
    'e="$("$@" 2>&1 >/dev/null)"; [ "$(printf "%s\n" "$e" | wc -l | tr -d " ")" = 2 ] && [[ "$e" == *language.reports* ]] && [[ "$e" == *language.docs* ]]' \
    _ "$pu" "$T/u/none" -C "$T/r/docsempty" --field language.docs
# CLAUDE_PROFILES_DIR (tests) overrides both places.
mkdir -p "$T/override/both"
printf '{"schema":2,"name":"both","title":"override","mode":"full"}\n' >"$T/override/both/profile.json"
eq "CLAUDE_PROFILES_DIR overrides both places" "$(printed "$T/override/both")" env CLAUDE_PROFILES_DIR="$T/override" HOME="$H" USERPROFILE="$H" HARNESS_HOME="$HH" "$PROFILE" -C "$T/r/both" --dir
# --- Silent mode: _resolved.mode, workflow_folder, repos -----------------
eq "silent: _resolved.mode" silent "$P2" -C "$T/r/demo" --field _resolved.mode
eq "silent without workflow.folder, one repository -> HARNESS_HOME/projects/<name>/workflow" "$(printed "$HH/projects/demo/workflow")" "$P2" -C "$T/r/demo" --field _resolved.workflow_folder
eq "silent: workflow.folder with ~/ is expanded" "$(printed "$H/wf")" "$P2" -C "$T/r/home" --field _resolved.workflow_folder
fails_with "silent: a relative workflow.folder -> 1 with the reason" 1 "not an absolute path" "$P2" -C "$T/r/relwf" --name
eq "silent, two repositories, no folder -> the folder above them" "$(printed "$T/r/multi")" "$P2" -C "$T/r/multi/m1" --field _resolved.workflow_folder
eq "silent, two repositories: _resolved.repos lists both" "m1 $(printed "$T/r/multi/m1") m1|m2 $(printed "$T/r/multi/m2") m2" \
    bash -c '"$@" | jq -r "map(\"\(.name) \(.path) \(.gate_key)\") | join(\"|\")"' _ "$P2" -C "$T/r/multi/m2" --field _resolved.repos
eq "silent, the common directory itself: the same Workflow folder" "$(printed "$T/r/multi")" "$P2" -C "$T/r/multi" --field _resolved.workflow_folder
eq "full: _resolved.mode" full "$P2" -C "$T/r/both" --field _resolved.mode
eq "schema 1: _resolved.mode full" full "$P2" -C "$T/r/legacy" --field _resolved.mode
eq "full: the Workflow folder is the working tree" "$(printed "$(cd "$T/r/both" && pwd -P)")" "$P2" -C "$T/r/both" --field _resolved.workflow_folder
eq "full: _resolved.repos of one repository" '[{"name":"both","gate_key":"both"}]' \
    bash -c '"$@" | jq -c "map({name, gate_key})"' _ "$P2" -C "$T/r/both" --field _resolved.repos
check "silent summary names the mode and the Workflow folder" 0 "mode: silent   workflow folder: $(printed "$H/wf")" "$P2" -C "$T/r/home"
check "full summary has no mode line" 0 "" bash -c '! "$@" | grep -q "^mode: "' _ "$P2" -C "$T/r/both"
# The relative tickets.root of a Silent profile is taken from the Workflow folder (bin/ticket applies the rule).
# ticket itself keeps the real HOME: only the profile it reads sees the sandbox. A shell script as
# CLAUDE_PROFILE_BIN cannot start on Windows (node runs no #! line there), so that form is POSIX-only.
case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) echo "skip tickets.root through a shell-script profile: node on Windows cannot start a shell script" ;;
    *)
        eq "silent: a relative tickets.root is taken from the Workflow folder" "$(printed "$H/wf/.scratch")" \
            env CLAUDE_PROFILE_BIN="$P2" bash -c 'cd "$0" && node "$1" root' "$T/r/home" "$BIN/ticket"
        eq "full: a relative tickets.root is still taken from the working tree" "$(printed "$(cd "$T/r/both" && pwd -P)/.scratch")" \
            env CLAUDE_PROFILE_BIN="$P2" bash -c 'cd "$0" && node "$1" root' "$T/r/both" "$BIN/ticket"
        ;;
esac
eq "silent: a relative tickets.root is taken from the Workflow folder (node profile script)" "$(printed "$H/wf/.scratch")" \
    env CLAUDE_PROFILE_BIN="$P2NODE" bash -c 'cd "$0" && node "$1" root' "$T/r/home" "$BIN/ticket"
eq "full: a relative tickets.root is still taken from the working tree (node profile script)" "$(printed "$(cd "$T/r/both" && pwd -P)/.scratch")" \
    env CLAUDE_PROFILE_BIN="$P2NODE" bash -c 'cd "$0" && node "$1" root' "$T/r/both" "$BIN/ticket"

after="$(snapshot)"
check "profile writes nothing into HOME or HARNESS_HOME" 0 "" test "$before" = "$after"

home_after="$(real_home_snapshot "$REAL_HOME")"
check "the real ~/.claude and ~/.claude/worfy-harness are unchanged" 0 "" test "$home_before" = "$home_after"
[ "$home_before" = "$home_after" ] || real_home_diff "$home_before" "$home_after"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
