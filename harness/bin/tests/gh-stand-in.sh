# Sourced by the Harness shell tests that stub gh for a Node script under test (wave-gate, ticket).
#
#   on_windows                        true in Git Bash (or Cygwin) on Windows
#   has_gh_word <text>                true when <text> names gh as a word (a command, a quoted name, a path)
#   node_path <path>                  the path as node reads it: C:/… in Git Bash on Windows, unchanged elsewhere
#   node_stand_in <stub> <file.mjs>   writes <file.mjs>, a node script that runs the shell stub <stub> with bash
#                                     and exits with its code; with $STAND_IN_PARENTS set it appends the pid of
#                                     its parent there, as node sees it. Node on Windows cannot start an extensionless
#                                     shell script, and its PATH lookup takes gh.com or gh.exe only, so a stub
#                                     on PATH loses to the real gh there; the script under test is pointed at
#                                     the .mjs through its own variable instead.
#   refusing_gh_exe <stub>            on Windows, writes <stub>.exe, a copy of `false`: node's own PATH lookup of a
#                                     bare gh, which takes gh.com or gh.exe only, finds it there and gets exit 1
#                                     with no output. Nothing elsewhere: node finds <stub> itself.
#   gh_guard <variable> <stub> <stand-in>
#                                     stops the test (exit 1) unless every gh it can start is a stand-in: the
#                                     shell's `gh` must be <stub>; the gh node starts must be <stand-in> when
#                                     $<variable> is set, otherwise <stub> (on Windows: <stub>.exe, the copy of
#                                     `false` refusing_gh_exe writes; without it the variable must be set there).
#                                     <variable> "-" — the script under test has no such variable (it starts gh
#                                     from the shell; the node check still covers the node scripts it runs).
#                                     It also keeps every usable credential away from gh: GH_TOKEN is a fixed
#                                     invalid value (gh reads it before hosts.yml and before the OS keyring, where
#                                     gh 2.24+ keeps its token), GITHUB_TOKEN, GH_ENTERPRISE_TOKEN and
#                                     GITHUB_ENTERPRISE_TOKEN are unset, GH_CONFIG_DIR is an empty folder. A real
#                                     gh reached anyway gets no credential that GitHub accepts.
on_windows() { command -v cygpath >/dev/null 2>&1; }
# has_gh_word <text>: true when <text> names gh as a word — a command gh, "gh", 'gh', a path …/gh, gh.exe.
has_gh_word() { local re='(^|[^[:alnum:]_.-])gh([^[:alnum:]_-]|$)'; [[ $1 =~ $re ]]; }
node_path() { cygpath -m "$1" 2>/dev/null || printf '%s' "$1"; }
node_stand_in() {
    local bash_bin stub
    bash_bin="$(node_path "$(command -v bash)")"
    stub="$(node_path "$1")"
    cat >"$2" <<EOF
#!/usr/bin/env node
// A stand-in written by gh-stand-in.sh: runs the shell stub with bash and exits with its code. With
// \$STAND_IN_PARENTS set, appends to that file the pid of the program that started it (one line a run).
import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
if (process.env.STAND_IN_PARENTS) appendFileSync(process.env.STAND_IN_PARENTS, process.ppid + "\\n")
const r = spawnSync("$bash_bin", ["$stub", ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(r.status ?? 1)
EOF
}
refusing_gh_exe() { if on_windows; then cp "$(type -P false)" "$1.exe"; fi; }
gh_guard() {
    local var="$1" stub="$2" stand_in="$3" sh_gh node_gh
    unset GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN
    export GH_TOKEN=worfy-test-no-token
    mkdir -p "$T/gh-config" && export GH_CONFIG_DIR="$T/gh-config"
    sh_gh="$(command -v gh)"
    if [ "$sh_gh" != "$stub" ]; then
        echo "REFUSED: gh in PATH is ${sh_gh:-missing}, not the stub $stub: the test would reach a real gh" >&2
        exit 1
    fi
    # What node would start for gh: $<variable>, else the first gh of PATH, looked up the way node looks it up.
    # "same" when that is the expected stand-in, otherwise what it is.
    node_gh="$(node -e '
const fs = require("fs"), path = require("path")
const [name, stub, standIn] = process.argv.slice(1)
const win = process.platform === "win32"
let got = process.env[name] || ""
if (!got) {
    search: for (const d of (process.env.PATH || "").split(path.delimiter)) {
        for (const e of win ? [".com", ".exe"] : [""]) {
            const f = path.join(d || ".", "gh" + e)
            try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) { got = f; break search } } catch {}
        }
    }
}
const norm = (p) => (win ? path.resolve(p).toLowerCase() : path.resolve(p))
const want = process.env[name] ? standIn : win ? stub + ".exe" : stub
process.stdout.write(got && norm(got) === norm(want) ? "same" : got || "nothing")
' "$var" "$stub" "$stand_in")"
    if [ "$node_gh" != same ]; then
        local shown="no override variable"; [ "$var" = - ] || shown="\$$var=${!var:-unset}"
        echo "REFUSED: node would start $node_gh for gh ($shown), not a stand-in: the test would reach a real gh" >&2
        exit 1
    fi
}
