#!/usr/bin/env bash
# Tests of harness/bin/qmd-sync-main, qmd-refresh and qmd-mcp on temporary directories (no network needed: origin is a local bare repository).
#   - qmd-sync-main: a copy that is not the root of its own repository — refusal without fetch/checkout;
#   - qmd-refresh: one broken profile / one missing copy do not stop the run —
#     qmd update is still called; with --quiet (Stop hook) exit 0, without --quiet — 1;
#     qmd embed only after the consent to the models;
#   - qmd-mcp: without the answer "downloaded" no server; the Russian query expansion
#     model only for a project with language.docs ru; the plugin's .mcp.json, the agents' qmd tools
#     and the Stop hook.
# Run: bash harness/bin/tests/qmd.test.sh; exit code 0 — everything passed.
# BIN_DIR — run the test against another copy of the scripts.
set -u
BIN="${BIN_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # the scripts next to this test (harness/bin)
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
gq() { git -c user.email=t@t -c user.name=t "$@"; }

# --- 5. qmd-sync-main: the copy must be the root of its own repository ---------------
gq init -q --bare -b main "$T/origin.git"
gq clone -q "$T/origin.git" "$T/seed" 2>/dev/null
gq -C "$T/seed" commit -q --allow-empty -m one && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
gq clone -q "$T/origin.git" "$T/outer" 2>/dev/null
gq -C "$T/seed" commit -q --allow-empty -m two && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
mkdir -p "$T/outer/sub"
printf '{"repos":[{"key":"x","match":"%s","profile":"x"}]}\n' "$T/outer" >"$T/config.json"
printf '#!/bin/sh\necho %s\n' "'{\"name\":\"x\",\"worktree\":{\"base\":\"origin/main\"}}'" >"$T/profile"
chmod +x "$T/profile"
before="$(git -C "$T/outer" rev-parse HEAD) $(git -C "$T/outer" symbolic-ref -q HEAD)"
out="$(CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile" QMD_SYNC_MARK="$T/mark" \
    QMD_SYNC_COPY="$T/outer/sub" zsh "$BIN/qmd-sync-main" x 2>&1)"; rc=$?
after="$(git -C "$T/outer" rev-parse HEAD) $(git -C "$T/outer" symbolic-ref -q HEAD)"
[ "$before" = "$after" ] && ok "sync: copy inside another repo -> enclosing repo untouched" \
    || bad "sync: enclosing repo changed: $before -> $after"
[ -s "$T/mark" ] && grep -q "is not the root" "$T/mark" && [[ "$out" == *"SYNC FAILED"* ]] \
    && ok "sync: refusal leaves marker + loud message" || bad "sync refusal: rc=$rc out=${out:0:200}"
rm -f "$T/mark"
# Regression: a real copy (a root) gets pulled.
out="$(CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile" QMD_SYNC_MARK="$T/mark" \
    QMD_SYNC_COPY="$T/outer" zsh "$BIN/qmd-sync-main" x 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ ! -e "$T/mark" ] && [ "$(git -C "$T/outer" rev-parse HEAD)" = "$(git -C "$T/seed" rev-parse HEAD)" ] \
    && ok "sync: real copy root -> fetched and checked out" || bad "sync real copy: rc=$rc out=${out:0:200}"

# --- 5b. qmd-sync-main --describe: profile warnings on stderr stay out of the JSON -------------
# bin/profile warns on stderr (a broken user.json, a malformed language) and still exits 0 with the
# JSON on stdout: the warning reaches the caller's stderr, the JSON is still read. A failing profile:
# exit 1, its own error on stderr once (profile runs once), then the line that it failed.
cat >"$T/profile-warn" <<'EOF2'
#!/bin/sh
echo 'profile: /x/profile.json: language.docs must be a language code such as "en", got null — ignored' >&2
echo '{"name":"x","worktree":{"base":"origin/trunk"},"github":{"account":"octo"}}'
EOF2
cat >"$T/profile-fail" <<'EOF2'
#!/bin/sh
echo 'profile: /x/user.json is not JSON — ignored' >&2
echo 'profile: /x/profile.json is not valid JSON: Unexpected end' >&2
exit 1
EOF2
chmod +x "$T/profile-warn" "$T/profile-fail"
out="$(HOME="$T/home-d" CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile-warn" \
    zsh "$BIN/qmd-sync-main" --describe x 2>"$T/describe.err")"; rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "$T/home-d/.cache/qmd/x-trunk"$'\t'"trunk"$'\t'"octo" ] \
    && ok "describe: a profile warning on stderr does not break the JSON" || bad "describe with a profile warning: rc=$rc out='${out:0:200}' err='$(head -c 200 "$T/describe.err")'"
grep -q 'language.docs must be a language code' "$T/describe.err" \
    && ok "describe: the profile warning reaches stderr" || bad "describe: the profile warning is lost"
out="$(HOME="$T/home-d" CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile-fail" \
    zsh "$BIN/qmd-sync-main" --describe x 2>"$T/describe.err")"; rc=$?
[ "$rc" -eq 1 ] && [ -z "$out" ] && grep -q "^profile: /x/profile.json is not valid JSON" "$T/describe.err" \
    && grep -q "^qmd-sync-main: profile -C .* failed$" "$T/describe.err" && [ "$(grep -c 'is not valid JSON' "$T/describe.err")" = 1 ] \
    && ok "describe: a failing profile -> exit 1, its own error once, then the failure" || bad "describe with a failing profile: rc=$rc out='${out:0:100}' err='$(head -c 300 "$T/describe.err")'"

# --- 6. qmd-refresh: a partial failure does not stop the run ----------------------
H="$T/home"; mkdir -p "$H/.cache/qmd" "$T/fakebin" "$T/mem"
echo note >"$T/mem/a.md"
cat >"$T/fakebin/qmd" <<EOF
#!/bin/sh
echo "\$1" >>"$T/qmd.calls"
EOF
cat >"$T/sync" <<EOF
#!/bin/sh
[ "\$1" = --describe ] || exit 0
case "\$2" in
  good)    printf '%s\tmain\t\n' "$T/outer" ;;
  missing) printf '%s\tmain\t\n' "$T/no-such-copy" ;;
  *)       echo "profile \$2 is not in the registry"; exit 1 ;;
esac
EOF
chmod +x "$T/fakebin/qmd" "$T/sync"
cat >"$T/index.yml" <<EOF
collections:
  bad:
    path: $T/x
    update: /x/qmd-sync-main bad
  missing:
    path: $T/y
    update: /x/qmd-sync-main missing
  good:
    path: $T/outer
    update: /x/qmd-sync-main good
  memory:
    path: $T/mem
EOF
run_refresh() {
    HOME="$H" PATH="$T/fakebin:$PATH" QMD_INDEX_YML="$T/index.yml" QMD_REFRESH_SYNC="$T/sync" \
        zsh "$BIN/qmd-refresh" --wait "$@" 2>&1
}
rm -f "$T/qmd.calls"
out="$(run_refresh --quiet)"; rc=$?
[ "$rc" -eq 0 ] && ok "refresh --quiet (Stop hook): bad profile + missing copy -> exit 0" || bad "refresh --quiet: rc=$rc out=${out:0:200}"
grep -qx update "$T/qmd.calls" 2>/dev/null && ok "refresh --quiet: qmd update still ran" || bad "refresh --quiet: qmd update not called"
grep -q "profile bad not resolved" "$H/.cache/qmd/refresh.log" 2>/dev/null && ok "refresh --quiet: warning logged" || bad "refresh --quiet: no warning in log"
rm -f "$T/qmd.calls" "$H/.cache/qmd/last-index"
out="$(run_refresh)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"profile bad not resolved"* ]] && [[ "$out" == *"no-such-copy"* ]] \
    && ok "refresh (manual): warns about both, exit 1 (partial failure)" || bad "refresh manual: rc=$rc out=${out:0:300}"
grep -qx update "$T/qmd.calls" 2>/dev/null && ok "refresh (manual): qmd update still ran" || bad "refresh manual: qmd update not called"

# A profile warning on the stderr of --describe (bin/profile warns and still answers): the copy is
# used, the warning passes through, and it is not read as part of the copy path.
cat >"$T/sync-warn" <<EOF
#!/bin/sh
[ "\$1" = --describe ] || exit 0
echo 'profile: /x/profile.json: language.docs must be a language code such as "en", got null — ignored' >&2
printf '%s\tmain\t\n' "$T/outer"
EOF
chmod +x "$T/sync-warn"
cat >"$T/index-warn.yml" <<EOF
collections:
  warns:
    path: $T/outer
    update: /x/qmd-sync-main warns
EOF
rm -f "$H/.cache/qmd/last-index"
out="$(HOME="$H" PATH="$T/fakebin:$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" \
    zsh "$BIN/qmd-refresh" --wait 2>"$T/refresh.err")"; rc=$?
[ "$rc" -eq 0 ] && [[ "$out" != *"is missing"* ]] && [[ "$out" != *"not resolved"* ]] \
    && ok "refresh: a profile warning on --describe's stderr -> the copy is used, exit 0" || bad "refresh with a profile warning: rc=$rc out=${out:0:300}"
grep -q 'language.docs must be a language code' "$T/refresh.err" \
    && ok "refresh: the profile warning passes through to stderr" || bad "refresh: the profile warning is lost: '$(head -c 200 "$T/refresh.err")'"
# A failure reported on --describe's stderr (the real qmd-sync-main): the reason reaches the warning.
cat >"$T/sync-fail" <<'EOF'
#!/bin/sh
[ "$1" = --describe ] || exit 0
echo 'profile: /x/user.json is not JSON — ignored' >&2
echo "qmd-sync-main: profile $2 is not in the registry /x/config.json" >&2
exit 1
EOF
chmod +x "$T/sync-fail"
out="$(HOME="$H" PATH="$T/fakebin:$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-fail" \
    zsh "$BIN/qmd-refresh" --wait 2>/dev/null)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"profile warns not resolved, its copy skipped — qmd-sync-main: profile warns is not in the registry"* ]] \
    && ok "refresh: a --describe failure on stderr -> its reason in the warning, exit 1" || bad "refresh with a failing --describe: rc=$rc out=${out:0:300}"

# --- 6b. qmd-refresh: qmd embed only with the consent to the models -----------------------
HH="$T/hh"; mkdir -p "$HH"
rm -f "$T/qmd.calls" "$H/.cache/qmd/last-index"
HARNESS_HOME="$HH" run_refresh --force --quiet >/dev/null; rc=$?
grep -qx embed "$T/qmd.calls" 2>/dev/null && bad "refresh without consent: qmd embed ran" \
    || { grep -qx update "$T/qmd.calls" 2>/dev/null && ok "refresh without consent: update ran, embed did not"; } \
    || bad "refresh without consent: rc=$rc calls=[$(cat "$T/qmd.calls" 2>/dev/null)]"
printf 'downloaded\n' >"$HH/qmd-models"
rm -f "$T/qmd.calls"
HARNESS_HOME="$HH" run_refresh --force --quiet >/dev/null
grep -qx embed "$T/qmd.calls" 2>/dev/null && ok "refresh with consent: qmd embed ran" || bad "refresh with consent: no embed: [$(cat "$T/qmd.calls" 2>/dev/null)]"
rm -f "$HH/qmd-models"

# --- 7. qmd-mcp: consent and the model of the project's language ---------------------------
RU='hf:AGmind/qmd-query-expansion-ru/qmd-query-expansion-ru-q4_k_m.gguf'
DEF='hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf'
EMB='hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf'
mkdir -p "$T/mcpbin" "$T/session"
cat >"$T/mcpbin/qmd" <<EOF
#!/bin/sh
echo "\$1 gen=\${QMD_GENERATE_MODEL:-unset} emb=\${QMD_EMBED_MODEL:-unset}" >>"$T/mcp.calls"
EOF
# The profile stub prints the language it is given in LANG_DOCS; "absent" — exit 4 like a missing field.
cat >"$T/profile-lang" <<'EOF'
#!/bin/sh
[ "$1 $2" = "--field language.docs" ] || exit 2
[ "$LANG_DOCS" = absent ] && exit 4
echo "$LANG_DOCS"
EOF
chmod +x "$T/mcpbin/qmd" "$T/profile-lang"
run_mcp() { # $1 = language of the stub; the rest — the answer file lines (none — no file)
    local lang="$1"; shift
    rm -f "$T/mcp.calls" "$HH/qmd-models"
    [ $# -gt 0 ] && printf '%s\n' "$@" >"$HH/qmd-models"
    (cd "$T/session" && HOME="$H" HARNESS_HOME="$HH" PATH="$T/mcpbin:$PATH" QMD_MCP_NO_REFRESH=1 \
        QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS="$lang" zsh "$BIN/qmd-mcp" 2>"$T/mcp.err")
}
for answer in none skipped; do
    if [ "$answer" = none ]; then run_mcp ru; else run_mcp ru skipped; fi; rc=$?
    [ "$rc" -ne 0 ] && [ "$(wc -l <"$T/mcp.err" | tr -d ' ')" = 1 ] && grep -q "consent" "$T/mcp.err" && [ ! -e "$T/mcp.calls" ] \
        && ok "qmd-mcp, answer $answer: exit $rc, one line in stderr, qmd mcp not started" \
        || bad "qmd-mcp, answer $answer: rc=$rc err=[$(cat "$T/mcp.err")] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
done
run_mcp ru downloaded; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=$RU emb=$EMB" ] \
    && ok "qmd-mcp, downloaded, language.docs ru: qmd mcp with the Russian model" || bad "qmd-mcp ru: rc=$rc calls=[$(cat "$T/mcp.calls" 2>/dev/null)] err=[$(cat "$T/mcp.err")]"
for lang in en absent; do
    run_mcp "$lang" downloaded; rc=$?
    [ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
        && ok "qmd-mcp, downloaded, language.docs $lang: qmd mcp with the default expansion model" || bad "qmd-mcp $lang: rc=$rc calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
done
run_mcp en downloaded "$EMB" "$RU"
[ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=$RU emb=$EMB" ] \
    && ok "qmd-mcp: only the Russian model was downloaded -> it, not a new download, for an en project" || bad "qmd-mcp consented list en: [$(cat "$T/mcp.calls" 2>/dev/null)]"
run_mcp ru downloaded "$EMB" "$DEF"
[ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
    && ok "qmd-mcp: only the default model was downloaded -> it for a ru project" || bad "qmd-mcp consented list ru: [$(cat "$T/mcp.calls" 2>/dev/null)]"

# --- 8. the plugin: .mcp.json, the agents' tools, the Stop hook ----------------------------
PLUGIN="$(cd "$BIN/.." && pwd)"
[ "$(jq -r '.mcpServers.qmd.command' "$PLUGIN/.mcp.json" 2>/dev/null)" = '${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp' ] && [ -x "$PLUGIN/bin/qmd-mcp" ] \
    && ok ".mcp.json: server qmd runs \${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp" || bad ".mcp.json: $(cat "$PLUGIN/.mcp.json" 2>/dev/null)"
for a in scout reviewer; do
    line="$(grep -m1 '^tools:' "$PLUGIN/agents/$a.md")"
    n=0; for t in query get multi_get status; do [[ "$line" == *"mcp__plugin_worfy_qmd__$t"* ]] && n=$((n + 1)); done
    [ "$n" = 4 ] && ok "$a: tools name the four mcp__plugin_worfy_qmd__ tools" || bad "$a: tools: $line"
done
# The old tool prefix is spelled in two halves, so this file does not match itself.
grep -rn 'mcp__''qmd__' "$PLUGIN" >/dev/null; rc=$?
[ "$rc" -eq 1 ] && ok "no old qmd tool names (mcp__ + qmd__) left in the plugin (grep exit 1)" || bad "old qmd tool names in the plugin: grep exit $rc"
jq -e '[.hooks.Stop[].hooks[].command] | index("\"${CLAUDE_PLUGIN_ROOT}/bin/qmd-refresh\" --quiet") != null' "$PLUGIN/hooks/hooks.json" >/dev/null \
    && ok "hooks.json: Stop runs qmd-refresh --quiet" || bad "hooks.json: no Stop hook qmd-refresh --quiet"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
