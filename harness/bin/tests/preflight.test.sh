#!/usr/bin/env bash
# Tests of harness/bin/preflight outside Auction. Run: bash harness/bin/tests/preflight.test.sh;
# exit code 0 — everything passed.
#
# The registry and profiles are temporary (CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR, bin/profile understands them),
# and so are HOME, HARNESS_HOME and CLAUDE_CONFIG_DIR: the lock step (worktree-lock) writes under HARNESS_HOME,
# which used to be the real ~/.claude/worfy-harness. The real one is compared with a snapshot at the end.
# Behaviour on Auction is checked by comparison with earlier output, not here: it depends on
# the live origin/main.
set -u
# The scripts under test are the copies next to this test (harness/); BIN_DIR and HOOKS_DIR
# point it at another copy.
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
PF="$BIN/preflight"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; the registry's "match"
# and the profiles' paths must be in it. TP is the same folder for PATH, where C:/… cannot stand.
T="$(mktemp -d)"; TP="$(cd "$T" && pwd -P)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
# A path as profile prints it: with backslashes on Windows (cygpath exists there), unchanged elsewhere; preflight
# prints the Workflow folder that way and joins its ADR directory with /.
printed() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
trap 'rm -rf "$T"' EXIT
. "$(dirname "$0")/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME" "$T")"
export HOME="$T/home" HARNESS_HOME="$T/hh" CLAUDE_CONFIG_DIR="$T/claude-config"
mkdir -p "$HOME" "$HARNESS_HOME" "$CLAUDE_CONFIG_DIR"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# preflight asks gh for the open PRs (and, for a github.com origin, the active account): a stub named gh first on
# PATH answers instead, logging its arguments to $GH_STUB_LOG and refusing (exit 1), as a real gh refuses in these
# repositories whose origin is a local folder; the PR line stays "gh unavailable: …". preflight is a node script
# and starts gh itself: on macOS and Linux node finds the stub on PATH; on Windows node's lookup takes gh.exe only,
# so $PREFLIGHT_GH names a node stand-in that runs the stub, and a refusing gh.exe next to the stub covers a bare
# lookup. The guard stops the test before any check if another gh could be started.
. "$(dirname "$0")/gh-stand-in.sh"
unset PREFLIGHT_GH
mkdir -p "$TP/stubs"
printf '#!/usr/bin/env bash\necho "$*" >>"$GH_STUB_LOG"\necho "gh stub: no GitHub in the tests" >&2\nexit 1\n' >"$TP/stubs/gh"
chmod +x "$TP/stubs/gh"; refusing_gh_exe "$TP/stubs/gh"
export PATH="$TP/stubs:$PATH" GH_STUB_LOG="$TP/gh-stub.log"
if on_windows; then node_stand_in "$TP/stubs/gh" "$TP/stubs/gh.mjs"; export PREFLIGHT_GH="$TP/stubs/gh.mjs"; fi
gh_guard PREFLIGHT_GH "$TP/stubs/gh" "$TP/stubs/gh.mjs"

export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
mkdir -p "$T/nogit" "$T/unreg" "$T/reg" "$T/profiles/t"
git -C "$T/unreg" init -q && git -C "$T/unreg" commit -q --allow-empty -m init
# A registered project without ADRs and migrations, with one epic "x" of one open ticket, with
# origin in a local bare repository.
git init -q --bare "$T/origin.git"
git -C "$T/reg" init -q -b main
mkdir -p "$T/reg/.scratch/x/issues"
printf '# 01 — a ticket\n\nStatus: open\n' >"$T/reg/.scratch/x/issues/01-a.md"
git -C "$T/reg" add -A && git -C "$T/reg" -c user.email=t@t -c user.name=t commit -q -m init
git -C "$T/reg" remote add origin "$T/origin.git" && git -C "$T/reg" push -q origin main 2>/dev/null
git -C "$T/reg" fetch -q origin
printf '{"repos":[{"key":"t","match":"%s","profile":"t","pm":"npm"}]}\n' "$T/reg" >"$CLAUDE_GATE_CONFIG"
printf '{"schema":1,"name":"t","worktree":{"base":"origin/main"},"numbering":{"adr":null,"migrations":null},"docs":{"adr_dir":null},"tickets":{"epic_status":null}}\n' \
    >"$T/profiles/t/profile.json"
: >"$T/profiles/t/rules.md"

# 1. An unregistered git repository: usage error, exit 2, a clear message.
err="$(cd "$T/unreg" && node "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"project not registered"* ]] && ok "unregistered repo -> exit 2 + message" \
    || bad "unregistered repo: exit $rc, err: ${err:0:300}"

# 1a. An unregistered git repository inside a profile's common directory (next to two
# repositories of the profile, itself not in the registry): also "not registered", not the neighbours' profile.
mkdir -p "$T/ws/a" "$T/ws/b" "$T/ws/foreign" "$T/profiles/w"
for d in a b foreign; do git -C "$T/ws/$d" init -q -b main && git -C "$T/ws/$d" commit -q --allow-empty -m init; done
printf '{"schema":1,"name":"w"}\n' >"$T/profiles/w/profile.json"
printf '{"repos":[{"key":"a","match":"%s","profile":"w"},{"key":"b","match":"%s","profile":"w"}]}\n' "$T/ws/a" "$T/ws/b" >"$T/ws.json"
err="$(cd "$T/ws/foreign" && CLAUDE_GATE_CONFIG="$T/ws.json" node "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"project not registered"* ]] && ok "unregistered repo inside a workspace -> exit 2" \
    || bad "foreign repo in workspace: exit $rc, err: ${err:0:300}"

# 2. A non-git directory — also exit 2.
err="$(cd "$T/nogit" && node "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"not a git repository"* ]] && ok "non-git dir -> exit 2" || bad "non-git dir: exit $rc, err: ${err:0:200}"

# 3. A registered project without ADRs/migrations: steps skipped with a line, the epics come from the
# Harness's own epic-status (the profile names none), verdict GO.
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= node "$PF" --no-fetch 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] \
   && [[ "$out" == *"ADR: no ADR directory in the profile"* ]] && [[ "$out" == *"migrations: no migrations journal in the profile"* ]] \
   && [[ "$out" == *"epics: 1, in progress 1"* ]] && [[ "$out" != *"no epic summary"* ]] && [[ "$out" == *"origin/main: "* ]]; then
    ok "registered, no numbering -> steps skipped aloud, GO exit 0"
else bad "registered no numbering: exit $rc, out: ${out:0:600}"; fi

# 4. The same project with --epic, its profile without tickets.epic_status: the epic is checked through
# the Harness's own epic-status, not BLOCKED.
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= node "$PF" --no-fetch --epic x 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] && [[ "$out" == *"epic: "*"x 0/1"* ]] \
    && ok "--epic without epic_status in the profile -> checked by the Harness's epic-status, GO" \
    || bad "--epic without epic_status: exit $rc, out: ${out:0:400}"

# 4a. An epic that does not exist: epic-status refuses, preflight BLOCKED with its reason, exit 1.
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= node "$PF" --no-fetch --epic nope 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$(printf '%s\n' "$out" | tail -1)" == "BLOCKED: epic-status nope: "* ]] \
    && ok "--epic of a missing epic -> BLOCKED by epic-status, exit 1" || bad "--epic missing epic: exit $rc, out: ${out:0:400}"

# 4b. A profile that still names an epic summary of its own (schema 1, a stale path) is not consulted.
printf '{"schema":1,"name":"t","worktree":{"base":"origin/main"},"numbering":{"adr":null,"migrations":null},"docs":{"adr_dir":null},"tickets":{"epic_status":"/nonexistent/epic-status"}}\n' \
    >"$T/profiles/t/profile.json"
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= node "$PF" --no-fetch --epic x 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] && [[ "$out" != *"/nonexistent/"* ]] \
    && ok "tickets.epic_status in the profile is ignored" || bad "stale epic_status: exit $rc, out: ${out:0:400}"

# 4c. Repositories whose main branch is master, in a profile with worktree.base null (Atakama):
# the base is not guessed as origin/main. ext — a clone, origin/HEAD -> origin/master; srv — no
# origin/HEAD, layout.repos.srv.default_branch is master; bare — neither, so origin/main as before.
mkdir -p "$T/m" "$T/profiles/m"
for r in ext srv bare; do
    git init -q --bare -b master "$T/m/$r.git"
    git -C "$T/m" init -q -b master "seed-$r" && git -C "$T/m/seed-$r" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
    git -C "$T/m/seed-$r" push -q "$T/m/$r.git" master 2>/dev/null
done
git clone -q "$T/m/ext.git" "$T/m/ext" 2>/dev/null
for r in srv bare; do
    git -C "$T/m" init -q -b master "$r" && git -C "$T/m/$r" remote add origin "$T/m/$r.git" && git -C "$T/m/$r" fetch -q origin
    git -C "$T/m/$r" reset -q --hard origin/master
    # git 2.48+ sets origin/HEAD on fetch; these two must have none.
    git -C "$T/m/$r" remote set-head origin -d >/dev/null 2>&1
    git -C "$T/m/$r" config remote.origin.followRemoteHEAD never
done
printf '{"schema":1,"name":"m","worktree":{"base":null},"layout":{"repos":{"srv":{"default_branch":"master"}}},"numbering":{"adr":null,"migrations":null},"docs":{"adr_dir":null}}\n' \
    >"$T/profiles/m/profile.json"
printf '{"repos":[{"key":"ext","match":"%s","profile":"m"},{"key":"srv","match":"%s","profile":"m"},{"key":"bare","match":"%s","profile":"m"}]}\n' \
    "$T/m/ext" "$T/m/srv" "$T/m/bare" >"$T/m.json"
for r in ext srv; do
    out="$(cd "$T/m/$r" && CLAUDE_GATE_CONFIG="$T/m.json" CLAUDE_SESSION_ID= node "$PF" --no-fetch 2>&1)"; rc=$?
    [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] && [[ "$out" == *"origin/master: "* ]] \
        && ok "worktree.base null, main branch master ($r) -> base origin/master, GO" \
        || bad "master base ($r): exit $rc, out: ${out:0:500}"
done
out="$(cd "$T/m/bare" && CLAUDE_GATE_CONFIG="$T/m.json" CLAUDE_SESSION_ID= node "$PF" --no-fetch 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$(printf '%s\n' "$out" | tail -1)" == "BLOCKED: "*"no ref origin/main"* ]] \
    && ok "worktree.base null, no origin/HEAD, no layout.repos -> origin/main (BLOCKED here)" \
    || bad "no hint for the base: exit $rc, out: ${out:0:500}"

# 4d. Silent mode (worfy-harness ticket 22): the ADR numbers are counted from the files of the ADR directory in
# the Workflow folder, not from git ls-tree of branches; a duplicate number there is BLOCKED, exit 1.
mkdir -p "$T/wf/docs/adr" "$T/profiles/s"
printf '{"schema":2,"name":"s","mode":"silent","workflow":{"folder":"%s"},"worktree":{"base":"origin/main"},"numbering":{"adr":{"dir":"docs/adr","check":null},"migrations":null}}\n' "$T/wf" \
    >"$T/profiles/s/profile.json"
: >"$T/profiles/s/rules.md"
printf '{"repos":[{"key":"s","match":"%s","profile":"s","pm":"npm"}]}\n' "$T/reg" >"$T/s.json"
touch "$T/wf/docs/adr/0001-a.md" "$T/wf/docs/adr/0007-b.md"
mkdir -p "$T/reg/docs/adr" && touch "$T/reg/docs/adr/0042-in-repo.md"   # a decoy: Silent mode does not count the repository
out="$(cd "$T/reg" && CLAUDE_GATE_CONFIG="$T/s.json" CLAUDE_SESSION_ID= node "$PF" --no-fetch 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] && [[ "$out" == *"ADR: Silent mode, highest 0007 in the Workflow folder ($(printed "$T/wf")/docs/adr) → next free 0008"* ]] \
    && ok "silent: ADR numbers from the Workflow folder -> next free 0008, GO" || bad "silent ADR: exit $rc, out: ${out:0:600}"
touch "$T/wf/docs/adr/0007-c.md"
out="$(cd "$T/reg" && CLAUDE_GATE_CONFIG="$T/s.json" CLAUDE_SESSION_ID= node "$PF" --no-fetch 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$(printf '%s\n' "$out" | tail -1)" == "BLOCKED: duplicate ADR 0007 in the Workflow folder"* ]] \
    && ok "silent: a duplicate ADR number in the Workflow folder -> BLOCKED, exit 1" || bad "silent ADR dup: exit $rc, out: ${out:0:600}"
rm -rf "$T/reg/docs"

# 4e. preflight stopped by TERM or Ctrl+C (INT) while a child runs: exit 143 or 130, and the child's process tree is
# gone. The child is a hanging epic-status in a copy of bin/ that starts a grandchild (sleep) and writes its pid.
if on_windows; then
    echo "skip 4e: Git Bash on Windows delivers no TERM or INT to a node process"
else
    mkdir -p "$T/pfcopy" && cp "$BIN/preflight" "$BIN/profile" "$BIN/worktree-lock" "$T/pfcopy/"
    printf '#!/usr/bin/env bash\nsleep 300 &\necho $! >"$SLEEPER"\nwait\n' >"$T/pfcopy/epic-status"; chmod +x "$T/pfcopy/epic-status"
    for sig in TERM:143 INT:130; do
        rm -f "$T/sleeper.pid"
        (cd "$T/reg" && SLEEPER="$T/sleeper.pid" CLAUDE_SESSION_ID= exec node "$T/pfcopy/preflight" --no-fetch --epic x >"$T/sig.out" 2>&1) &
        pid=$!
        for _ in $(seq 1 100); do [ -s "$T/sleeper.pid" ] && break; sleep 0.1; done
        kill -"${sig%%:*}" "$pid"; wait "$pid"; rc=$?
        sp="$(cat "$T/sleeper.pid" 2>/dev/null)"
        for _ in $(seq 1 20); do [ -n "$sp" ] && kill -0 "$sp" 2>/dev/null || break; sleep 0.05; done
        if [ "$rc" -eq "${sig#*:}" ] && [ -n "$sp" ] && ! kill -0 "$sp" 2>/dev/null && ! grep -q '^GO\|^BLOCKED' "$T/sig.out"; then
            ok "SIG${sig%%:*} while epic-status runs -> exit ${sig#*:}, its process tree is stopped, no verdict"
        else
            bad "SIG${sig%%:*}: exit $rc, grandchild ${sp:-none} $(kill -0 "$sp" 2>/dev/null && echo alive), out: $(head -c 300 "$T/sig.out")"
            [ -n "$sp" ] && kill "$sp" 2>/dev/null
        fi
    done
fi

# 5. A broken profile (invalid JSON) — exit 2, not GO.
printf '{broken' >"$T/profiles/t/profile.json"
err="$(cd "$T/reg" && node "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"profile unreadable"* ]] && ok "broken profile -> exit 2" || bad "broken profile: exit $rc, err: ${err:0:200}"

# The functions below are exported by preflight and called through require; main runs only when the file is run.
# PFN is the script's path as node reads it (C:/… in Git Bash on Windows).
PFN="$(node_path "$PF")"

# 6. Timeout: a child that starts a grandchild and both wait forever. withTimeout(1 s) returns 124 within 3 s,
# and the grandchild is gone too (the whole process tree is stopped, not only the child). The grandchild may need
# a moment to be reaped after the kill, so its absence is polled for up to 1 s.
cat >"$T/tree.js" <<'EOF'
const { spawn } = require("node:child_process")
const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
require("node:fs").writeFileSync(process.argv[2], String(g.pid))
setInterval(() => {}, 1000)
EOF
out="$(node -e '
const [pf, tree, pidFile] = process.argv.slice(1)
const { withTimeout } = require(pf)
const t0 = Date.now()
withTimeout(1, process.execPath, [tree, pidFile]).then(async (r) => {
    const ms = Date.now() - t0
    const pid = Number(require("node:fs").readFileSync(pidFile, "utf8"))
    let state = "alive"
    for (let i = 0; i < 20 && state === "alive"; i++) {
        try { process.kill(pid, 0); await new Promise((res) => setTimeout(res, 50)) } catch (e) { state = e.code }
    }
    if (state === "alive") try { process.kill(pid, "SIGKILL") } catch {}
    console.log(`${r.code} ${ms <= 3000 ? "in time" : "late " + ms + " ms"} ${state}`)
})' "$PFN" "$(node_path "$T/tree.js")" "$(node_path "$T/grandchild.pid")" 2>&1)"
[ "$out" = "124 in time ESRCH" ] && ok "timeout: exit 124 within 3 s, the grandchild is stopped too" || bad "timeout: [$out]"

# 6a. A program that is not there: exit 127 and no output, as a shell reports a command it cannot start.
out="$(node -e 'require(process.argv[1]).withTimeout(5, "preflight-no-such-program", []).then((r) => console.log(r.code, JSON.stringify(r.stdout + r.stderr)))' "$PFN" 2>&1)"
[ "$out" = '127 ""' ] && ok "a missing program -> exit 127, no output" || bad "missing program: [$out]"

# 7. The pure functions on the inputs the header names.
out="$(node -e 'console.log(require(process.argv[1]).adrScan(["0001-a.md", "0001-b.md"]))' "$PFN" 2>&1)"
[ "$out" = "highest 0001 · duplicates 0001" ] && ok "adrScan: 0001-a.md 0001-b.md -> highest 0001 · duplicates 0001" || bad "adrScan: [$out]"
out="$(node -e 'console.log(require(process.argv[1]).adrScan(["docs/adr/0005-x.md", "0005-y.md", "0007-z.md", "README.md"]))' "$PFN" 2>&1)"
[ "$out" = "highest 0007 · duplicates 0005" ] && ok "adrScan: paths and a non-ADR name -> highest 0007 · duplicates 0005" || bad "adrScan paths: [$out]"
out="$(node -e 'console.log(require(process.argv[1]).adrScan([]))' "$PFN" 2>&1)"
[ "$out" = "highest none · duplicates none" ] && ok "adrScan: no names -> highest none · duplicates none" || bad "adrScan empty: [$out]"
out="$(node -e 'console.log(require(process.argv[1]).adrCollisions("0098\tfoo.md\torigin/a\n0098\tbar.md\torigin/b\n0099\tsame.md\torigin/a\n0099\tsame.md\tlocal:c\n").join("; "))' "$PFN" 2>&1)"
[ "$out" = "0098: origin/a, origin/b" ] && ok "adrCollisions: 0098 in two branches with different files -> 0098: origin/a, origin/b" || bad "adrCollisions: [$out]"
out="$(node -e 'const { migLast } = require(process.argv[1]); console.log([`{"entries":[{"idx":"0077"}]}`, `{"entries":[{"idx":3},{"idx":12}]}`, `{"entries":[]}`, `{"entries":[{"idx":"7a"}]}`, "not json", ""].map((s) => JSON.stringify(migLast(s))).join(" "))' "$PFN" 2>&1)"
[ "$out" = '"77" "12" "" "" "" ""' ] && ok "migLast: \"0077\" -> 77, the last entry, empty for no entries, a non-number, broken JSON" || bad "migLast: [$out]"
# Cyrillic "privet", a waving-hand emoji (two UTF-16 units), Cyrillic "mir": spelled as escapes, the file stays ASCII.
out="$(node -e '
const { cutChars } = require(process.argv[1])
const s = "\u043f\u0440\u0438\u0432\u0435\u0442 \u{1F44B} \u043c\u0438\u0440"
const got = [cutChars(s, 8), cutChars(s, 7), cutChars("short", 60)]
const want = ["\u043f\u0440\u0438\u0432\u0435\u0442 \u{1F44B}\u2026", "\u043f\u0440\u0438\u0432\u0435\u0442 \u2026", "short"]
console.log(JSON.stringify(got) === JSON.stringify(want) ? "whole" : JSON.stringify(got))' "$PFN" 2>&1)"
[ "$out" = whole ] && ok "cutChars: cuts by characters, Cyrillic and an emoji are whole" || bad "cutChars: [$out]"
# Child output that is not valid UTF-8 comes out byte for byte, and each stray byte counts as one character.
out="$(node -e '
const { decode, encode, cutChars } = require(process.argv[1])
const b = Buffer.from([0x61, 0xff, 0xd0, 0xbf, 0xf0, 0x9f, 0x91, 0x8b, 0xed, 0xa0, 0x80, 0xc3])
const s = decode(b)
console.log(encode(s).equals(b), Array.from(s).length, encode(cutChars(s, 2)).toString("hex"))' "$PFN" 2>&1)"
[ "$out" = "true 8 61ffe280a6" ] && ok "decode/encode: invalid UTF-8 passes through unchanged, a stray byte is one character" || bad "decode/encode: [$out]"
LOCK_OUT='/r:
  holds a0184940  since 06:54  seen 7 min ago  ← this
   also b1234567  since 06:00  seen 45 min ago'
out="$(node -e 'console.log(JSON.stringify(require(process.argv[1]).lockReport(process.argv[2], process.argv[3])))' "$PFN" "$LOCK_OUT" a0184940-full-id 2>&1)"
[ "$out" = '[["say","lock: another live session b1234567 (heartbeat 45 min ago, possibly abandoned)"],["block","another live session in the tree: b1234567 (heartbeat 45 min ago, possibly abandoned)"]]' ] \
    && ok "lockReport: holds … ← this and a foreign also … -> another live session, BLOCKED" || bad "lockReport foreign: [$out]"
out="$(node -e 'console.log(JSON.stringify(require(process.argv[1]).lockReport(process.argv[2], "")))' "$PFN" "$LOCK_OUT" 2>&1)"
[ "$out" = '[["warn","lock: a live session in the tree b1234567 (heartbeat 45 min ago, possibly abandoned); ours or another — cannot tell, no CLAUDE_SESSION_ID"]]' ] \
    && ok "lockReport: a foreign session without CLAUDE_SESSION_ID -> a warning, not BLOCKED" || bad "lockReport no id: [$out]"
out="$(node -e 'console.log(JSON.stringify(require(process.argv[1]).lockReport(process.argv[2], "s")))' "$PFN" '/r:
  holds a0184940  since 06:54  seen just now  ← this' 2>&1)"
[ "$out" = '[["say","lock: held by this session (heartbeat just now)"]]' ] && ok "lockReport: only this session, the holder -> held by this session" || bad "lockReport own: [$out]"

# preflight's gh calls reached the stub: at least one, each a PR list (or the account query)
calls="$(grep -c . "$GH_STUB_LOG" 2>/dev/null)"
[ "${calls:-0}" -ge 1 ] && ! grep -qvE '^(pr list |api user)' "$GH_STUB_LOG" \
    && ok "preflight's gh calls went to the stub (gh pr list)" || bad "gh stub log: ${calls:-0} calls [$(head -n 3 "$GH_STUB_LOG" 2>/dev/null)]"

home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$home_before") <(printf '%s\n' "$home_after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
