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
    && ok "--help lists what the check does not catch" || bad "--help: exit $rc"

# The fixture of stand-in forms and this ticket pass the check themselves.
node "$CHECK" "$FIX/stand-ins.md" >"$T/out-fix.txt" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "fixture of stand-in forms -> exit 0" || bad "fixture: exit $rc: $(head -c 600 "$T/out-fix.txt")"
TICKET_FILE="$HARNESS/../.scratch/worfy-evidence/issues/02-privacy-check-evidence-check.md"
if [ -f "$TICKET_FILE" ]; then
    node "$CHECK" "$TICKET_FILE" >"$T/out-ticket.txt" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && ok "the ticket file -> exit 0" || bad "ticket file: exit $rc: $(head -c 600 "$T/out-ticket.txt")"
fi

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

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"
real_home_diff "$home_before" "$home_after"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
