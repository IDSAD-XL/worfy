#!/usr/bin/env bash
# Tests of the privacy rules (harness/lib/privacy.cjs) and of the privacy check over a branch
# (harness/bin/evidence-check).
# Run: bash harness/bin/tests/evidence-check.test.sh; exit code 0 — everything passed.
#
# Every value the rules must find is put together here from pieces ("/Us""ers/"…), so this file holds
# none of them whole and passes the check itself. The names are stand-ins (jdoe, example hosts), never
# a real user, host or account. The texts go to node through files, not through argv: Git Bash on
# Windows rewrites an argument that looks like a POSIX path (/c/…) before node sees it.
# HARNESS_HOME is a temporary folder (the personal deny list lives there); the real home is checked
# to be unchanged at the end.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"   # BIN_DIR — run the test against another copy of the tools
LIB="$HARNESS/lib/privacy.cjs"
CHECK="$BIN/evidence-check"
FIX="$(dirname "$0")/fixtures/evidence-check"
# T in node's spelling (C:/… in Git Bash on Windows, pwd -P elsewhere).
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
. "$(dirname "$0")/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HARNESS_HOME="$T/hh"
unset GITHUB_ACTIONS
# An empty registry: profile answers "not registered" (exit 3), and ticket root falls back to <git top-level>/.scratch.
mkdir -p "$HARNESS_HOME/user" "$HARNESS_HOME/gate"; printf '{"repos":[]}\n' >"$HARNESS_HOME/gate/config.json"
export CLAUDE_GATE_CONFIG="$HARNESS_HOME/gate/config.json"
unset CLAUDE_PROFILES_DIR CLAUDE_TICKET_BIN CLAUDE_PROFILE_BIN

# --- values, from pieces ------------------------------------------------------------------------
NAME="jd""oe"
MAC_PATH="/Us""ers/$NAME/proj"
LINUX_PATH="/ho""me/$NAME/proj"
WIN_PATH='C:\Us''ers\'"$NAME"'\proj'
WIN_JSON='C:\\Us''ers\\'"$NAME"'\\proj'
WIN_FWD="C:/Us""ers/$NAME/proj"
GITBASH_PATH="/c/Us""ers/$NAME/proj"
HOST_LOCAL="$NAME-Mac""Book-Pro.lo""cal"
HOST_TS="$NAME-box.tail0000.ts.n""et"
HOST_DESK="DESK""TOP-AB12CD3"
HOST_PC="$NAME-""PC"
HOST_MAC="${NAME}s-""Mac-mini"
TS_IP="100.""100.1.2"
DENY_WORD="Zorblax""ian"
OWN_HOST="$NAME-wo""rkbox"
UUID="1b4e28ba-2fa1-""11d2-883f-0016d3cca427"
EMAIL="$NAME@acme-""mail.io"
A20="aaaaaaaaaaaaaaaaaaaa"
TOK_GH="gh""p_${A20}0123456789abcdef"
TOK_PAT="github""_pat_11ABCDEFG0${A20}"
TOK_SK="sk-""ant-api03-${A20}"
TOK_AKIA="AK""IAABCDEFGHIJKLMNOP"
TOK_XOX="xo""xb-1234567890-${A20}"
TOK_JWT="ey""JhbGciOiJIUzI1NiJ9.ey""JzdWIiOiIxMjM0NTY3ODkwIn0.${A20}"
TOK_PEM="-----BEGIN ""RSA PRIVATE KEY-----"
TOK_BEARER="Bear""er ${A20}xyz"
ALL_VALUES=("$NAME" "$MAC_PATH" "$NAME/proj" "$HOST_LOCAL" "$HOST_TS" "$HOST_DESK" "$HOST_PC" "$HOST_MAC" "$TS_IP" "$DENY_WORD" "$OWN_HOST" "$UUID" "$EMAIL"
    "$TOK_GH" "$TOK_PAT" "$TOK_SK" "$TOK_AKIA" "$TOK_XOX" "$TOK_JWT" "$TOK_BEARER" "${A20}xyz")

# --- helpers --------------------------------------------------------------------------------------
# rules_in <text> [<options JSON>] — the rule names privacy.findings gives for <text>, comma-separated.
cat >"$T/rules.cjs" <<'JS'
const fs = require("fs")
const [lib, file, opts, op] = process.argv.slice(2)
const p = require(lib)
const text = fs.readFileSync(file, "utf8")
const options = JSON.parse(opts || "{}")
if (op === "mask") process.stdout.write(p.maskText(text, options))
else if (op === "maskvalue") process.stdout.write(p.mask(text))
else if (op === "personal") process.stdout.write(JSON.stringify(p.personal(text)))
else process.stdout.write(p.findings(text, options).map((f) => f.rule).join(","))
JS
rules_in() { printf '%s' "$1" >"$T/in.txt"; node "$T/rules.cjs" "$LIB" "$T/in.txt" "${2:-}"; }
lib_op() { printf '%s' "$1" >"$T/in.txt"; node "$T/rules.cjs" "$LIB" "$T/in.txt" "${3:-}" "$2"; }
expect_rule() { # <label> <text> <rule> [<options>]
    local got; got="$(rules_in "$2" "${4:-}")"
    [ "$got" = "$3" ] && ok "$1 -> $3" || bad "$1: expected $3, got '${got}'"
}
expect_none() { # <label> <text> [<options>]
    local got; got="$(rules_in "$2" "${3:-}")"
    [ -z "$got" ] && ok "$1 -> no finding" || bad "$1: expected no finding, got '${got}'"
}
# leaks <file> — the fixture values found whole in <file>; empty when every value is masked.
leaks() {
    local v
    for v in "${ALL_VALUES[@]}"; do grep -qF -- "$v" "$1" && printf '%s\n' "${v:0:3}…"; done
}

# --- 1. privacy.cjs: home paths ---------------------------------------------------------------------
expect_rule "mac home path" "see $MAC_PATH/x" home-path
expect_rule "linux home path" "cwd=$LINUX_PATH" home-path
expect_rule "windows home path" "dir $WIN_PATH\\x" home-path
expect_rule "windows home path in JSON" "{\"cwd\":\"$WIN_JSON\"}" home-path
expect_rule "windows home path with /" "at $WIN_FWD" home-path
expect_rule "git bash home path" "at $GITBASH_PATH" home-path
expect_rule "home path at the end of text" "/Us""ers/$NAME" home-path
expect_none "stand-in test (macOS)" "/Us""ers/test/proj"
expect_none "stand-in C:\\Users\\runneradmin\\" 'C:\Us''ers\runneradmin\work'
expect_none "stand-in C:\\Users\\RUNNER~1\\" 'C:\Us''ers\RUNNER~1\AppData'
expect_none "stand-ins Shared (macOS) and runner (Linux)" "/Us""ers/Shared/x /ho""me/runner/work"
expect_none "stand-in <name> (macOS)" "/Us""ers/<name>/x"
expect_none "~/.claude and %USERPROFILE%" '~/.claude/x %USERPROFILE%\.claude'
expect_none "a URL with /home/ in it" "https://exam""ple.com/home/page/"
expect_none "a home folder of a stand-in place" "<tmp>/ho""me/cwd …/ho""me/.gitconfig"

# --- 2. hosts, Tailscale address, deny list --------------------------------------------------------
expect_rule "*-MacBook-Pro.local" "host $HOST_LOCAL here" host
expect_rule "*.ts.net" "ssh $HOST_TS" host
expect_rule "DESKTOP- and seven" "on $HOST_DESK" host
expect_rule "*-PC" "on $HOST_PC" host
expect_rule "*s-Mac*" "on $HOST_MAC" host
expect_rule "Tailscale address" "ip $TS_IP:22" tailscale-ip
expect_none "address outside 100.64/10, and the network itself" "ip 100.""128.1.2 and 100.""63.1.2, net 100.""64.0.0/10"
expect_none "localhost" "http://localhost:3000 .env.local ~/.local/share"
expect_none "hosts with an example label" "pc.exam""ple.ts.net other.exam""ple.local"
expect_rule "the machine's short host name" "from $OWN_HOST today" host "{\"hostname\":\"$OWN_HOST.lan\"}"
expect_rule "a word of the deny list" "said ${DENY_WORD}s" deny "{\"deny\":[\"$DENY_WORD\"]}"
printf '{"deny":["%s"]}\n' "$DENY_WORD" >"$HARNESS_HOME/user/privacy.json"
got="$(lib_op "$HARNESS_HOME" personal)"
[ "$got" = "{\"deny\":[\"$DENY_WORD\"]}" ] && ok "personal reads <harness home>/user/privacy.json" || bad "personal: got $(printf '%s' "$got" | wc -c) bytes"
mkdir -p "$T/broken/user"; printf '{"deny": [' >"$T/broken/user/privacy.json"
got="$(lib_op "$T/broken" personal)"
[ "$got" = '{"deny":[]}' ] && ok "personal with a broken file -> { deny: [] }" || bad "personal broken: got '$got'"
got="$(lib_op "$T/none" personal)"
[ "$got" = '{"deny":[]}' ] && ok "personal without a file -> { deny: [] }" || bad "personal missing: got '$got'"

# --- 3. UUID, email, tokens ------------------------------------------------------------------------
expect_rule "UUID" "id $UUID" uuid
expect_none "UUID of one digit" "00000000-0000-0000-0000-000000000000 44444444-4444-4444-8444-444444444444"
expect_rule "email" "mail $EMAIL" email
expect_none "noreply and example addresses" "noreply@anthropic.com 1+jdoe@users.noreply.github.com git@github.com jdoe@exam""ple.com a@mail.exam""ple.org react@18.3.1 icon_16x16@2x.png"
for v in TOK_GH TOK_PAT TOK_SK TOK_AKIA TOK_XOX TOK_JWT TOK_PEM TOK_BEARER; do
    expect_rule "token $v" "key: ${!v}" token
done
expect_none "token stand-ins" "sk-ant-… ghp_… Bearer <token> a task-list feature/sk-learn-upgrade-for-models"

# --- 4. mask and maskText ---------------------------------------------------------------------------
got="$(lib_op "$TOK_GH" maskvalue)"
[ "$got" = "gh…(${#TOK_GH})" ] && ok "mask -> two letters, …, length" || bad "mask: got '$got'"
got="$(lib_op "ab" maskvalue)"
[ "$got" = "a…(2)" ] && ok "mask of a two-letter value keeps one letter" || bad "mask short: got '$got'"
TEXT="a $MAC_PATH b $HOST_LOCAL c $UUID d $TOK_GH e $EMAIL f $DENY_WORD"
lib_op "$TEXT" mask "{\"deny\":[\"$DENY_WORD\"]}" >"$T/masked.txt"
l="$(leaks "$T/masked.txt")"
[ -z "$l" ] && grep -q '^a /Us''ers/jd…(4)/proj b ' "$T/masked.txt" && ok "maskText leaves none of the values" || bad "maskText leaks: $l"

# --- 5. evidence-check: explicit files, metadata of images -----------------------------------------
[ -f "$CHECK" ] || bad "harness/bin/evidence-check is missing"
# mkimg.cjs <kind> <out> <text file> — an image whose metadata holds the text of <text file>.
cat >"$T/mkimg.cjs" <<'JS'
const fs = require("fs"), zlib = require("zlib")
const [kind, out, textFile] = process.argv.slice(2)
const text = textFile ? fs.readFileSync(textFile) : Buffer.alloc(0)
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, "latin1"), data, u32(crc(Buffer.concat([Buffer.from(type, "latin1"), data])))])
const z = Buffer.from([0])
function png(extra) {
    const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])
    const idat = zlib.deflateSync(Buffer.from([0, 0]))
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))])
}
const seg = (marker, data) => { const l = Buffer.alloc(2); l.writeUInt16BE(data.length + 2); return Buffer.concat([Buffer.from([0xff, marker]), l, data]) }
const riff = (fourcc, data) => { const l = Buffer.alloc(4); l.writeUInt32LE(data.length); return Buffer.concat([Buffer.from(fourcc, "latin1"), l, data, data.length % 2 ? z : Buffer.alloc(0)]) }
let buf
if (kind === "png-plain") buf = png([])
else if (kind === "png-plain2") buf = png([chunk("tEXt", Buffer.concat([Buffer.from("Software"), z, Buffer.from("paint 2")]))])
else if (kind === "png-text") buf = png([chunk("tEXt", Buffer.concat([Buffer.from("Comment"), z, text]))])
else if (kind === "png-itxt") buf = png([chunk("iTXt", Buffer.concat([Buffer.from("Comment"), z, Buffer.from([1, 0]), z, z, zlib.deflateSync(text)]))])
else if (kind === "png-ztxt") buf = png([chunk("zTXt", Buffer.concat([Buffer.from("Comment"), z, z, zlib.deflateSync(text)]))])
else if (kind === "jpeg-exif") buf = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0MM\0*\0\0\0\x08", "latin1"), text, z])), seg(0xda, Buffer.from([0, 0, 0])), Buffer.from([0xff, 0xd9])])
else if (kind === "jpeg-com") buf = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xfe, text), seg(0xda, Buffer.from([0, 0, 0])), Buffer.from([0xff, 0xd9])])
else if (kind === "webp-exif") { const body = Buffer.concat([Buffer.from("WEBP"), riff("VP8L", Buffer.from([0x2f, 0, 0, 0, 0])), riff("EXIF", text)]); const l = Buffer.alloc(4); l.writeUInt32LE(body.length); buf = Buffer.concat([Buffer.from("RIFF"), l, body]) }
else if (kind === "gif-comment") buf = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([1, 0, 1, 0, 0x80, 0, 0]), Buffer.alloc(6), Buffer.from([0x21, 0xfe, text.length]), text, z, Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0, 0x3b])])
else if (kind === "bin") buf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0, 1, 2, 3])])
else throw new Error("unknown kind " + kind)
fs.writeFileSync(out, buf)
JS
mkimg() { printf '%s' "${3:-}" >"$T/img.txt"; node "$T/mkimg.cjs" "$1" "$2" "$T/img.txt"; }
mkdir -p "$T/files"
mkimg png-text "$T/files/a.png" "cwd $MAC_PATH"
mkimg png-itxt "$T/files/b.png" "host $HOST_TS"
mkimg png-ztxt "$T/files/c.png" "by $EMAIL"
mkimg jpeg-exif "$T/files/d.jpg" "owner $UUID"
mkimg jpeg-com "$T/files/e.jpeg" "on $HOST_DESK"
mkimg webp-exif "$T/files/f.webp" "key $TOK_GH"
mkimg gif-comment "$T/files/g.gif" "ip $TS_IP"
mkimg png-plain2 "$T/files/clean.png"
printf 'line one\nsee %s\nok\n' "$MAC_PATH" >"$T/files/notes.md"
(cd "$T/files" && node "$CHECK" a.png b.png c.png d.jpg e.jpeg f.webp g.gif clean.png notes.md) >"$T/out-files.txt" 2>&1; rc=$?
for want in "a.png:tEXt: home-path: jd…(4)" "b.png:iTXt: host: " "c.png:zTXt: email: " "d.jpg:APP1: uuid: " "e.jpeg:COM: host: " \
    "f.webp:EXIF: token: gh…(" "g.gif:comment: tailscale-ip: " "notes.md:2: home-path: jd…(4)"; do
    grep -qF -- "$want" "$T/out-files.txt" && ok "metadata/text finding: $want" || bad "missing '$want' (exit $rc): $(head -c 600 "$T/out-files.txt")"
done
grep -q 'clean.png' "$T/out-files.txt" && bad "clean.png reported" || ok "an image with clean metadata -> no finding"
grep -q 'needs a human check' "$T/out-files.txt" && bad "an explicit file asked for a scrub: note" || ok "explicit images need no scrub: note"
[ "$rc" -eq 1 ] && [ "$(tail -n 1 "$T/out-files.txt")" = "evidence-check: 8 findings" ] && ok "findings -> exit 1, last line counts them" || bad "explicit files: exit $rc, last: $(tail -n 1 "$T/out-files.txt")"
l="$(leaks "$T/out-files.txt")"; [ -z "$l" ] && ok "explicit files: no value printed whole" || bad "explicit files leak: $l"

(cd "$T/files" && node "$CHECK" clean.png) >"$T/out-clean.txt" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/out-clean.txt")" = "evidence-check: ok (1 files)" ] && ok "clean file -> exit 0, ok line" || bad "clean: exit $rc: $(cat "$T/out-clean.txt")"
node "$CHECK" --bogus >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "unknown option -> exit 2" || bad "unknown option: exit $rc"
node "$CHECK" "$T/files/missing.md" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "missing file -> exit 2" || bad "missing file: exit $rc"
node "$CHECK" --help >"$T/help.txt" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -q 'does not catch' "$T/help.txt" && grep -q 'pixels' "$T/help.txt" && grep -q 'history' "$T/help.txt" \
    && grep -q 'between the seconds of its contact sheet' "$T/help.txt" && grep -q 'pixels of a clip' "$T/help.txt" \
    && ok "--help lists what the check does not catch" || bad "--help: exit $rc"

# The fixture of stand-in forms and this ticket pass the check themselves.
node "$CHECK" "$FIX/stand-ins.md" >"$T/out-fix.txt" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "fixture of stand-in forms -> exit 0" || bad "fixture: exit $rc: $(head -c 600 "$T/out-fix.txt")"
for TICKET_FILE in "$HARNESS/../.scratch/worfy-evidence/issues/02-privacy-check-evidence-check.md" "$HARNESS/../.scratch/worfy-evidence/issues/10-"*.md; do
    [ -f "$TICKET_FILE" ] || continue
    node "$CHECK" "$TICKET_FILE" >"$T/out-ticket.txt" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && ok "the ticket file $(basename "$TICKET_FILE" | cut -c1-2) -> exit 0" || bad "ticket file: exit $rc: $(head -c 600 "$T/out-ticket.txt")"
done
node "$CHECK" "$(dirname "$0")/fixtures/evidence/mkclip.cjs" "$(dirname "$0")/fixtures/evidence/grammar.json" "$(dirname "$0")/fixtures/evidence/ru/02-states.md" >"$T/out-fix2.txt" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "the shared Evidence fixtures and the clip builder -> exit 0" || bad "evidence fixtures: exit $rc: $(head -c 600 "$T/out-fix2.txt")"

# --- 6. evidence-check --changed in a temporary repository -----------------------------------------
R="$T/repo"; mkdir -p "$R/.scratch/ep/issues" "$R/.scratch/ep/evidence" "$R/docs"
g() { git -C "$R" -c user.name=t -c user.email=t@example.com "$@"; }
g init -q -b main
printf 'old %s\n- evidence: screenshot pass · `../evidence/07-old.png` · mac dev · abc1234 · scrub: 2026-11-01\n' "$MAC_PATH" >"$R/.scratch/ep/issues/01-a.md"
mkimg png-plain "$R/.scratch/ep/evidence/05-mod.png"
g add -A && g commit -q -m base
g update-ref refs/remotes/origin/main HEAD
g checkout -q -b feature
printf 'new %s\n' "$GITBASH_PATH" >>"$R/.scratch/ep/issues/01-a.md"
{
    printf '# 02\n\nid %s\n' "$UUID"
    printf -- '- evidence: screenshot pass · `../evidence/10-marked.png` · mac dev · abc1234 · scrub: 2026-11-04\n'
    printf -- '- evidence: screenshot pass · `../../other/evidence/11-same.png` · mac dev · abc1234 · scrub: 2026-11-04\n'
    printf -- '- evidence: screenshot pass · `../evidence/13-noscrub.png` · mac dev · abc1234\n'
} >"$R/.scratch/ep/issues/02-b.md"
mkimg png-plain "$R/.scratch/ep/evidence/07-old.png"
mkimg png-plain "$R/.scratch/ep/evidence/10-marked.png"
mkimg png-plain "$R/.scratch/ep/evidence/11-same.png"
mkimg png-plain "$R/.scratch/ep/evidence/13-noscrub.png"
mkimg png-plain2 "$R/.scratch/ep/evidence/05-mod.png"
mkimg png-plain "$R/.scratch/ep/evidence/16-$HOST_DESK.png"
mkimg bin "$R/.scratch/ep/evidence/report.pdf"
CYR="$(node -e 'process.stdout.write("03-\u0444\u0430\u0439\u043b")')"
printf 'on %s\n' "$HOST_DESK" >"$R/.scratch/ep/issues/$CYR.md"
printf 'see %s\n' "$MAC_PATH" >"$R/docs/outside.md"
g add -A && g commit -q -m feature
printf 'late %s\n' "$TOK_AKIA" >"$R/.scratch/ep/issues/05-late.md"
g add -A && g commit -q -m late
printf 'mail %s\n' "$EMAIL" >"$R/.scratch/ep/issues/04-staged.md"; g add .scratch/ep/issues/04-staged.md
mkimg png-plain "$R/.scratch/ep/evidence/12-untracked.png"
printf 'ip %s\n' "$TS_IP" >"$R/.scratch/ep/evidence/notes.txt"

(cd "$R" && node "$CHECK" --changed) >"$T/out-changed.txt" 2>&1; rc=$?
for want in ".scratch/ep/issues/01-a.md:3: home-path: jd…(4)" ".scratch/ep/issues/02-b.md:3: uuid: " ".scratch/ep/issues/$CYR.md:1: host: " \
    ".scratch/ep/issues/05-late.md:1: token: " ".scratch/ep/issues/04-staged.md:1: email: " ".scratch/ep/evidence/notes.txt:1: tailscale-ip: " \
    ".scratch/ep/evidence/07-old.png:-: scrub: image needs a human check (no scrub: note)" \
    ".scratch/ep/evidence/11-same.png:-: scrub: image needs a human check" ".scratch/ep/evidence/13-noscrub.png:-: scrub: image needs a human check" \
    ".scratch/ep/evidence/12-untracked.png:-: scrub: image needs a human check" ".scratch/ep/evidence/report.pdf:-: scrub: " \
    ".scratch/ep/evidence/16-DE…(15).png:path: host: DE…(15)" ".scratch/ep/evidence/16-DE…(15).png:-: scrub: "; do
    grep -qF -- "$want" "$T/out-changed.txt" && ok "--changed reports: $want" || bad "--changed misses '$want' (exit $rc): $(head -c 1500 "$T/out-changed.txt")"
done
grep -q '01-a.md:1:' "$T/out-changed.txt" && bad "--changed reported an old line" || ok "--changed: the old line is not a finding"
grep -q '10-marked.png' "$T/out-changed.txt" && bad "--changed reported the marked image" || ok "--changed: added image with a scrub: note whose ref leads to it -> clean"
grep -q '05-mod.png' "$T/out-changed.txt" && bad "--changed reported the changed image" || ok "--changed: changed image without a note -> no finding"
grep -q 'outside.md' "$T/out-changed.txt" && bad "--changed read a file outside the tickets root" || ok "--changed: files outside the tickets root are not read"
grep -q '\\[0-7][0-7][0-7]' "$T/out-changed.txt" && bad "--changed printed octal escapes" || ok "--changed: Cyrillic name printed without octal escapes"
[ "$rc" -eq 1 ] && [ "$(tail -n 1 "$T/out-changed.txt")" = "evidence-check: 13 findings" ] && ok "--changed: exit 1 and 13 findings" || bad "--changed: exit $rc, last: $(tail -n 1 "$T/out-changed.txt")"
l="$(leaks "$T/out-changed.txt")"; [ -z "$l" ] && ok "--changed: no value printed whole" || bad "--changed leaks: $l"

# The base: --base, and HEAD^1 in GitHub Actions.
(cd "$R" && node "$CHECK" --changed --base HEAD) >"$T/out-base.txt" 2>&1; rc=$?
grep -q '02-b.md\|05-late.md' "$T/out-base.txt" && bad "--base HEAD read committed files" || ok "--base HEAD: committed files are not read"
grep -q '04-staged.md' "$T/out-base.txt" && grep -q '12-untracked.png' "$T/out-base.txt" && ok "--base HEAD: staged and untracked files are read" || bad "--base HEAD: exit $rc: $(head -c 600 "$T/out-base.txt")"
(cd "$R" && GITHUB_ACTIONS=true node "$CHECK" --changed) >"$T/out-gha.txt" 2>&1; rc=$?
grep -q '05-late.md' "$T/out-gha.txt" && ! grep -q '02-b.md' "$T/out-gha.txt" && ok "GitHub Actions: the base is HEAD^1" || bad "GitHub Actions base: exit $rc: $(head -c 600 "$T/out-gha.txt")"
g update-ref -d refs/remotes/origin/main
(cd "$R" && node "$CHECK" --changed) >"$T/out-nobase.txt" 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "no base -> exit 2" || bad "no base: exit $rc: $(head -c 300 "$T/out-nobase.txt")"

# A clean branch, and a tickets root outside the repository (Silent mode).
C="$T/clean"; mkdir -p "$C/.scratch/ep/issues"
git -C "$C" init -q -b main && printf 'a\n' >"$C/.scratch/ep/issues/01.md" && git -C "$C" add -A && git -C "$C" -c user.name=t -c user.email=t@example.com commit -q -m a
printf 'b\n' >>"$C/.scratch/ep/issues/01.md"
(cd "$C" && node "$CHECK" --changed --base HEAD) >"$T/out-ok.txt" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/out-ok.txt")" = "evidence-check: ok (1 files)" ] && ok "--changed on a clean branch -> exit 0, ok (1 files)" || bad "clean branch: exit $rc: $(cat "$T/out-ok.txt")"
mkdir -p "$T/workflow/.scratch"
(cd "$C" && node "$CHECK" --changed --root "$T/workflow/.scratch") >"$T/out-silent.txt" 2>&1; rc=$?
[ "$rc" -eq 0 ] && grep -qx 'evidence-check: nothing to check (tickets root is outside the repository)' "$T/out-silent.txt" \
    && ok "tickets root outside the repository -> exit 0, nothing to check" || bad "silent: exit $rc: $(cat "$T/out-silent.txt")"
# Silent mode by the profile: the Workflow folder is a fresh git init (project-connect), and still nothing to check.
SR="$T/sil"; SW="$T/sil-wf"; mkdir -p "$SW/.scratch/ep/issues" "$T/sil-profiles/sil"
git -C "$T" init -q -b main sil; git -C "$SW" init -q 2>/dev/null || git init -q "$SW"
printf 'id %s\n' "$UUID" >"$SW/.scratch/ep/issues/01.md"
printf '{"repos":[{"key":"sil","match":"%s","profile":"sil","pm":"npm","root":{},"workspace":{}}]}\n' "$SR" >"$T/sil-config.json"
printf '{"schema":2,"name":"sil","mode":"silent","workflow":{"folder":"%s"},"tickets":{"root":".scratch/"}}\n' "$SW" >"$T/sil-profiles/sil/profile.json"
: >"$T/sil-profiles/sil/rules.md"
for how in "--root $SW/.scratch" ""; do
    # shellcheck disable=SC2086 # $how is one option and its value, or nothing
    (cd "$SR" && CLAUDE_GATE_CONFIG="$T/sil-config.json" CLAUDE_PROFILES_DIR="$T/sil-profiles" node "$CHECK" --changed $how) >"$T/out-silent2.txt" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && grep -qx 'evidence-check: nothing to check (tickets root is outside the repository)' "$T/out-silent2.txt" \
        && ok "Silent mode by the profile, Workflow folder in git, ${how:-tickets root from ticket root} -> nothing to check" \
        || bad "silent profile ${how:-no --root}: exit $rc: $(head -c 400 "$T/out-silent2.txt")"
done
# With --root the repository is the one that holds the tickets root, not the one of the working directory.
(cd "$T" && node "$CHECK" --changed --root "$R/.scratch" --base HEAD) >"$T/out-root-nogit.txt" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -qF ".scratch/ep/issues/04-staged.md:1: email: " "$T/out-root-nogit.txt" \
    && ok "--root in a repository, run from outside git -> that repository is checked" || bad "--root from outside git: exit $rc: $(head -c 600 "$T/out-root-nogit.txt")"
(cd "$C" && node "$CHECK" --changed --root "$R/.scratch" --base HEAD) >"$T/out-root-other.txt" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -qF ".scratch/ep/issues/04-staged.md:1: email: " "$T/out-root-other.txt" \
    && ok "--root in a repository, run from another repository -> the root's repository is checked" || bad "--root from another repo: exit $rc: $(head -c 600 "$T/out-root-other.txt")"

# --- 7. clips (.webm, .mp4): container metadata, sound, size, duration ------------------------------------------------
# The clips are built from bytes by fixtures/evidence/mkclip.cjs: EBML elements and ISO BMFF boxes, no frames. Each
# value is put together from pieces above; the spec goes to node through a file.
MKCLIP="$(dirname "$0")/fixtures/evidence/mkclip.cjs"
mkclip() { if [ -n "${2:-}" ]; then printf '%s' "$2" >"$T/clip.json"; node "$MKCLIP" "$1" "$T/clip.json"; else node "$MKCLIP" "$1"; fi; }
V="$T/clips"; mkdir -p "$V"
MB8=$((8 * 1024 * 1024))
mkclip "$V/clean.webm"
mkclip "$V/lavf.webm" '{"writingApp":"Lavf60.16.100","muxingApp":"Lavf60.16.100","tagName":"ENCODER","tagString":"Lavc60.31.102 libvpx"}'
mkclip "$V/w-title.webm" "{\"title\":\"$MAC_PATH/clip\"}"
mkclip "$V/w-tag.webm" "{\"tagString\":\"$MAC_PATH/x\"}"
mkclip "$V/w-att.webm" "{\"attachment\":\"$HOST_LOCAL.txt\"}"
mkclip "$V/w-track.webm" "{\"trackName\":\"by $EMAIL\"}"
mkclip "$V/w-live.webm" "{\"liveCluster\":true,\"tagString\":\"id $UUID\"}"
mkclip "$V/w-muxing.webm" "{\"muxingApp\":\"on $HOST_DESK\"}"
mkclip "$V/w-audio.webm" '{"audio":true}'
mkclip "$V/w-big.webm" "{\"size\":$((MB8 + 1))}"
mkclip "$V/w-8mb.webm" "{\"size\":$MB8}"
mkclip "$V/w-61.webm" '{"duration":61}'
mkclip "$V/w-60.webm" '{"duration":60}'
mkclip "$V/w-scale.webm" '{"duration":61,"timecodeScale":1000}'
mkclip "$V/w-nodur.webm" '{"duration":null}'
mkclip "$V/clean.mp4" '{"format":"mp4"}'
mkclip "$V/m-too.mp4" "{\"format\":\"mp4\",\"too\":\"$MAC_PATH/enc\"}"
mkclip "$V/m-lavf.mp4" '{"format":"mp4","too":"Lavf61.1.100"}'
mkclip "$V/m-nam.mp4" "{\"format\":\"mp4\",\"nam\":\"key $TOK_GH\"}"
mkclip "$V/m-xmp.mp4" "{\"format\":\"mp4\",\"xmp\":\"<x:xmpmeta>$EMAIL</x:xmpmeta>\"}"
mkclip "$V/m-audio.mp4" '{"format":"mp4","audio":true}'
mkclip "$V/m-61.mp4" '{"format":"mp4","duration":61}'
mkclip "$V/m-nodur.mp4" '{"format":"mp4","duration":null}'
mkclip "$V/m-big.mp4" "{\"format\":\"mp4\",\"size\":$((MB8 + 1))}"
printf 'not a clip at all' >"$V/broken.webm"
(cd "$V" && node "$CHECK" clean.webm lavf.webm w-title.webm w-tag.webm w-att.webm w-track.webm w-live.webm w-muxing.webm w-audio.webm w-big.webm w-8mb.webm \
    w-61.webm w-60.webm w-scale.webm w-nodur.webm clean.mp4 m-too.mp4 m-lavf.mp4 m-nam.mp4 m-xmp.mp4 m-audio.mp4 m-61.mp4 m-nodur.mp4 m-big.mp4 broken.webm) >"$T/out-clips.txt" 2>&1; rc=$?
for want in "w-title.webm:Title: home-path: jd…(4)" "w-tag.webm:TagString: home-path: jd…(4)" "w-att.webm:FileName: host: " "w-track.webm:Name: email: " \
    "w-live.webm:TagString: uuid: " "w-muxing.webm:MuxingApp: host: " "m-too.mp4:©too: home-path: jd…(4)" "m-nam.mp4:©nam: token: gh…(" "m-xmp.mp4:XMP: email: " \
    "w-audio.webm:-: video: video has an audio track" "m-audio.mp4:-: video: video has an audio track" \
    "w-big.webm:-: video: video over 8 MB" "m-big.mp4:-: video: video over 8 MB" "w-61.webm:-: video: video over 60 s" "w-scale.webm:-: video: video over 60 s" \
    "m-61.mp4:-: video: video over 60 s" "w-nodur.webm:-: video: video duration unknown" "m-nodur.mp4:-: video: video duration unknown" \
    "broken.webm:-: video: video duration unknown" "broken.webm:-: video: video container not fully parsed"; do
    grep -qF -- "$want" "$T/out-clips.txt" && ok "clip finding: $want" || bad "clip: missing '$want' (exit $rc): $(head -c 1500 "$T/out-clips.txt")"
done
for clean in clean.webm lavf.webm w-8mb.webm w-60.webm clean.mp4 m-lavf.mp4; do
    grep -qF "$clean:" "$T/out-clips.txt" && bad "clip $clean reported: $(grep -F "$clean:" "$T/out-clips.txt")" || ok "clip $clean -> no finding"
done
grep -q 'needs a human check\|contact sheet' "$T/out-clips.txt" && bad "an explicit clip asked for a scrub: note or a sheet" || ok "explicit clips need no scrub: note and no sheet"
[ "$rc" -eq 1 ] && [ "$(tail -n 1 "$T/out-clips.txt")" = "evidence-check: 20 findings" ] && ok "clips: exit 1, 20 findings" || bad "clips: exit $rc, last: $(tail -n 1 "$T/out-clips.txt")"
l="$(leaks "$T/out-clips.txt")"; [ -z "$l" ] && ok "clips: no value printed whole" || bad "clips leak: $l"

# Text in any element or box outside the frames is read, not only in the named ones; a container the reader cannot
# read to its end is a finding of its own (and what is left is still read as text); .mov, .m4v and .mkv are clips.
W="$T/clips-any"; mkdir -p "$W"
HP="$MAC_PATH/rec"
mkclip "$W/a-segfile.webm" "{\"info\":[[\"7384\",\"$HP.webm\"]]}"
mkclip "$W/a-prevfile.webm" "{\"info\":[[\"3c83ab\",\"$HP.webm\"]]}"
mkclip "$W/a-nextfile.webm" "{\"info\":[[\"3e83bb\",\"$HP.webm\"]]}"
mkclip "$W/a-codecname.webm" "{\"track\":[[\"258688\",\"$HP\"]]}"
mkclip "$W/a-filedata.webm" "{\"fileData\":\"cwd $HP\"}"
mkclip "$W/a-target.webm" "{\"targetType\":\"$HP\"}"
mkclip "$W/a-void.webm" "{\"segment\":[[\"ec\",\"cwd $HP\"]]}"
mkclip "$W/a-unlisted.webm" "{\"segment\":[[\"5a5a\",\"cwd $HP\"]]}"
mkclip "$W/a-writing.webm" "{\"writingApp\":\"$HP\"}"
mkclip "$W/a-tagname.webm" "{\"tagName\":\"$HP\",\"tagString\":\"ok\"}"
mkclip "$W/a-filedesc.webm" "{\"fileDescription\":\"$HP\"}"
mkclip "$W/a-chapter.webm" "{\"chapString\":\"$HP\"}"
mkclip "$W/a-garbage.webm" "{\"segment\":[{\"raw\":\"00000000\"},{\"tags\":\"cwd $HP\"}]}"
mkclip "$W/a-cues.webm" "{\"segment\":[{\"unknown\":\"1c53bb6b\"},{\"tags\":\"cwd $HP\"}]}"
mkclip "$W/a-deep.webm" "{\"deepTag\":40,\"tagString\":\"$HP\"}"
mkclip "$W/a-trunc.webm" '{"segment":[{"raw":"ec0100000000001000"}]}'
mkclip "$W/a-type2.webm" '{"audio":"type"}'
mkclip "$W/a-codec.webm" '{"audio":"codec"}'
mkclip "$W/a-element.webm" '{"audio":"element"}'
mkclip "$W/a-info2.webm" '{"duration":5,"secondInfo":61}'
mkclip "$W/a-info2b.webm" '{"duration":61,"secondInfo":5}'
mkclip "$W/b-free.mp4" "{\"format\":\"mp4\",\"top\":[{\"type\":\"free\",\"text\":\"old moov $HP\"}]}"
mkclip "$W/b-skip.mp4" "{\"format\":\"mp4\",\"top\":[{\"type\":\"skip\",\"text\":\"$HP\"}]}"
mkclip "$W/b-dref.mp4" "{\"format\":\"mp4\",\"minf\":[{\"type\":\"dinf\",\"children\":[{\"type\":\"dref\",\"full\":true,\"hex\":\"00000001\",\"children\":[{\"type\":\"url \",\"full\":true,\"text\":\"file://$HP.mov\"}]}]}]}"
mkclip "$W/b-minfudta.mp4" "{\"format\":\"mp4\",\"minf\":[{\"type\":\"udta\",\"children\":[{\"type\":\"name\",\"text\":\"$HP\"}]}]}"
mkclip "$W/b-moofuuid.mp4" "{\"format\":\"mp4\",\"top\":[{\"type\":\"moof\",\"children\":[{\"type\":\"traf\",\"children\":[{\"type\":\"uuid\",\"hex\":\"01010101010101010101010101010101\",\"text\":\"$HP\"}]}]}]}"
mkclip "$W/b-ilst2.mp4" "{\"format\":\"mp4\",\"too\":\"Lavf61.1.100\",\"ilst\":[{\"type\":\"zzzz\",\"text\":\"$HP\"}]}"
mkclip "$W/b-broken.mp4" "{\"format\":\"mp4\",\"top\":[{\"raw\":\"000000046a756e6b\"}],\"xmp\":\"<x>cwd $HP</x>\"}"
mkclip "$W/b-hdlrname.mp4" "{\"format\":\"mp4\",\"hdlrName\":\"$HP\"}"
mkclip "$W/b-keys.mp4" "{\"format\":\"mp4\",\"meta\":[{\"type\":\"keys\",\"text\":\"$HP\"}]}"
mkclip "$W/b-udtaxmp.mp4" "{\"format\":\"mp4\",\"udta\":[{\"type\":\"XMP_\",\"text\":\"by $EMAIL\"}]}"
mkclip "$W/b-twomoov.mp4" '{"format":"mp4","duration":600,"secondMoov":5}'
mkclip "$W/b-frag.mp4" '{"format":"mp4","duration":1,"mehd":600}'
mkclip "$W/b-frag-ok.mp4" '{"format":"mp4","duration":0,"mehd":5}'
mkclip "$W/b-short.mp4" '{"format":"mp4","audio":"short"}'
mkclip "$W/b-stsd.mp4" '{"format":"mp4","audio":"stsd"}'
mkclip "$W/c-clip.mov" '{"format":"mp4","audio":true}'
mkclip "$W/c-clip.m4v" '{"format":"mp4","duration":61}'
mkclip "$W/c-clip.mkv" "{\"title\":\"$HP\"}"
(cd "$W" && node "$CHECK" -- *.webm *.mp4 c-clip.mov c-clip.m4v c-clip.mkv) >"$T/out-any.txt" 2>&1; rc=$?
for want in "a-segfile.webm:SegmentFilename: home-path: jd…(4)" "a-prevfile.webm:PrevFilename: home-path" "a-nextfile.webm:NextFilename: home-path" \
    "a-codecname.webm:CodecName: home-path" "a-filedata.webm:FileData: home-path" "a-target.webm:TargetType: home-path" "a-void.webm:Void: home-path" \
    "a-unlisted.webm:0x5a5a: home-path" "a-writing.webm:WritingApp: home-path" "a-tagname.webm:TagName: home-path" "a-filedesc.webm:FileDescription: home-path" \
    "a-chapter.webm:ChapString: home-path" "a-garbage.webm:-: video: video container not fully parsed" "a-garbage.webm:unparsed: home-path" \
    "a-cues.webm:-: video: video container not fully parsed" "a-cues.webm:unparsed: home-path" "a-deep.webm:-: video: video container not fully parsed" \
    "a-deep.webm:unparsed: home-path" "a-trunc.webm:-: video: video container not fully parsed" \
    "a-type2.webm:-: video: video has an audio track" "a-codec.webm:-: video: video has an audio track" "a-element.webm:-: video: video has an audio track" \
    "a-info2.webm:-: video: video over 60 s" "a-info2b.webm:-: video: video over 60 s" \
    "b-free.mp4:free: home-path" "b-skip.mp4:skip: home-path" "b-dref.mp4:url: home-path" "b-minfudta.mp4:name: home-path" "b-moofuuid.mp4:uuid: home-path" \
    "b-ilst2.mp4:©too: home-path" "b-broken.mp4:-: video: video container not fully parsed" "b-broken.mp4:unparsed: home-path" "b-hdlrname.mp4:hdlr: home-path" \
    "b-keys.mp4:keys: home-path" "b-udtaxmp.mp4:XMP_: email" "b-twomoov.mp4:-: video: video over 60 s" "b-frag.mp4:-: video: video over 60 s" \
    "b-short.mp4:-: video: video has an audio track" "b-stsd.mp4:-: video: video has an audio track" \
    "c-clip.mov:-: video: video has an audio track" "c-clip.m4v:-: video: video over 60 s" "c-clip.mkv:Title: home-path"; do
    grep -qF -- "$want" "$T/out-any.txt" && ok "clip text and structure: $want" || bad "clip: missing '$want' (exit $rc): $(head -c 2500 "$T/out-any.txt")"
done
grep -qF "b-frag-ok.mp4" "$T/out-any.txt" && bad "a fragmented mp4 of 5 s reported: $(grep -F b-frag-ok "$T/out-any.txt")" || ok "fragmented mp4: mvhd 0 and mehd 5 s -> no finding"
grep -qF "b-ilst2.mp4:©too: home-path" "$T/out-any.txt" && ! grep -qF "b-ilst2.mp4:©too: host" "$T/out-any.txt" && ok "an ilst item: the Lavf encoder in data is no finding" || true
l="$(leaks "$T/out-any.txt")"; [ -z "$l" ] && ok "clip text: no value printed whole" || bad "clip text leak: $l"
[ "$rc" -eq 1 ] && ok "clip text and structure -> exit 1" || bad "clip text: exit $rc"

# --changed: the scrub: note of a clip is an added "- evidence: video … · scrub:" line whose ref leads to it, and its
# contact sheet <name>.sheet.png is added by the same branch.
R2="$T/repo2"; E2="$R2/.scratch/ep/evidence"; mkdir -p "$R2/.scratch/ep/issues" "$E2"
g2() { git -C "$R2" -c user.name=t -c user.email=t@example.com "$@"; }
g2 init -q -b main
printf '# 01\n' >"$R2/.scratch/ep/issues/01-a.md"
mkclip "$E2/01-old.webm"
mkimg png-plain "$E2/08-oldsheet.sheet.png"
mkimg png-plain "$E2/14-modsheet.sheet.png"
g2 add -A && g2 commit -q -m base
g2 update-ref refs/remotes/origin/main HEAD
g2 checkout -q -b feature
note() { printf -- '- evidence: %s pass · `../evidence/%s` · mac dev · abc1234%s\n' "$1" "$2" "${3- · scrub: 2026-11-05}"; }
{
    printf '# 02\n\n'
    note video 02-marked.webm
    note video 09-marked.mp4
    note screenshot 04-shot.webm
    note video 05-nosheet.webm
    note video 06-dirtysheet.webm
    note video 07-noscrub.webm ''
    note video 08-oldsheet.webm
    note screenshot 10-screen.mov
    note video 12-image.png
    note video 13-plain.webm
    note video 14-modsheet.webm
    note video 15-UP.WEBM
    note video 16-badsheet.webm
} >"$R2/.scratch/ep/issues/02-b.md"
for c in 02-marked 03-noline 04-shot 05-nosheet 06-dirtysheet 07-noscrub 08-oldsheet; do mkclip "$E2/$c.webm"; done
mkclip "$E2/09-marked.mp4" '{"format":"mp4"}'
for c in 02-marked 03-noline 04-shot 07-noscrub 09-marked; do mkimg png-plain "$E2/$c.sheet.png"; done
mkimg png-text "$E2/06-dirtysheet.sheet.png" "cwd $MAC_PATH"
mkclip "$E2/01-old.webm" '{"duration":7}'
mkclip "$E2/10-screen.mov" '{"format":"mp4"}'; mkimg png-plain "$E2/10-screen.sheet.png"
mkimg png-plain "$E2/12-image.png"
mkclip "$E2/13-plain.webm"; mkimg png-plain "$E2/13-plain.png"
mkclip "$E2/14-modsheet.webm"; mkimg png-plain2 "$E2/14-modsheet.sheet.png"
mkclip "$E2/15-UP.WEBM"; mkimg png-plain "$E2/15-UP.sheet.png"
mkclip "$E2/16-badsheet.webm"; printf 'x' >"$E2/16-badsheet.sheet.png"
# Symbolic links: git publishes the link text, not the target. The target here holds a home path in its Title.
links=0
if ln -s "$T/clips-any/a-segfile.webm" "$E2/17-link.webm" 2>/dev/null && [ -L "$E2/17-link.webm" ]; then
    ln -s "/Us""ers/$NAME/Movies/x.webm" "$E2/18-home.webm"; links=1
else
    rm -f "$E2/17-link.webm" # Git Bash without symbolic links copies the target instead
fi
g2 add -A && g2 commit -q -m feature
(cd "$R2" && node "$CHECK" --changed) >"$T/out-clips2.txt" 2>&1; rc=$?
P=".scratch/ep/evidence"
for want in "$P/03-noline.webm:-: scrub: video needs a human check (no scrub: note)" "$P/03-noline.sheet.png:-: scrub: image needs a human check" \
    "$P/04-shot.webm:-: scrub: video needs a human check (no scrub: note)" "$P/05-nosheet.webm:-: scrub: video needs a contact sheet" \
    "$P/06-dirtysheet.sheet.png:tEXt: home-path: jd…(4)" "$P/07-noscrub.webm:-: scrub: video needs a human check (no scrub: note)" \
    "$P/08-oldsheet.webm:-: scrub: video needs a contact sheet" "$P/10-screen.mov:-: scrub: video needs a human check (no scrub: note)" \
    "$P/12-image.png:-: scrub: image needs a human check" "$P/13-plain.webm:-: scrub: video needs a contact sheet" "$P/13-plain.png:-: scrub: image needs a human check" \
    "$P/14-modsheet.webm:-: scrub: video needs a contact sheet" "$P/16-badsheet.sheet.png:-: sheet: contact sheet is not a PNG"; do
    grep -qF -- "$want" "$T/out-clips2.txt" && ok "--changed clip: $want" || bad "--changed clip misses '$want' (exit $rc): $(head -c 1500 "$T/out-clips2.txt")"
done
if [ "$links" -eq 1 ]; then
    for want in "$P/17-link.webm:-: link: symbolic link points outside the repository" "$P/18-home.webm:link: home-path: jd…(4)" \
        "$P/18-home.webm:-: link: symbolic link points outside the repository"; do
        grep -qF -- "$want" "$T/out-clips2.txt" && ok "--changed link: $want" || bad "--changed link misses '$want': $(head -c 2500 "$T/out-clips2.txt")"
    done
    grep -qF "$P/17-link.webm:SegmentFilename" "$T/out-clips2.txt" && bad "--changed read the target of a link" || ok "--changed: a link is read as its text, not its target"
else
    echo "skip symbolic link cases: no symbolic links here"
fi
for clean in 02-marked.webm 02-marked.sheet.png 09-marked.mp4 09-marked.sheet.png 01-old.webm 04-shot.sheet.png 06-dirtysheet.webm: 07-noscrub.sheet.png \
    15-UP.WEBM 15-UP.sheet.png 16-badsheet.webm 10-screen.sheet.png; do
    case "$clean" in
        04-shot.sheet.png|07-noscrub.sheet.png|10-screen.sheet.png) # a sheet of a clip that has no video note of its own: an image without a note
            grep -qF "$P/$clean:-: scrub: image needs a human check" "$T/out-clips2.txt" && ok "--changed: $clean is not covered by a clip without a video note" \
                || bad "--changed: $clean should need its own note: $(head -c 1500 "$T/out-clips2.txt")" ;;
        *) grep -qF "$P/$clean" "$T/out-clips2.txt" && bad "--changed reported $clean: $(grep -F "$P/$clean" "$T/out-clips2.txt")" || ok "--changed: $clean -> no finding" ;;
    esac
done
want_n=$((16 + 3 * links))
[ "$rc" -eq 1 ] && [ "$(tail -n 1 "$T/out-clips2.txt")" = "evidence-check: $want_n findings" ] && ok "--changed clips: exit 1, $want_n findings" || bad "--changed clips: exit $rc, last: $(tail -n 1 "$T/out-clips2.txt")"
l="$(leaks "$T/out-clips2.txt")"; [ -z "$l" ] && ok "--changed clips: no value printed whole" || bad "--changed clips leak: $l"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"
real_home_diff "$home_before" "$home_after"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
