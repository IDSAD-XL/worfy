# Sourced by the Harness shell tests that must not write into the real home.
#
#   real_home_snapshot <home> [<marker>]
#   real_home_diff <before> <after>
#
# real_home_snapshot prints one line per file of the Harness parts of <home>/.claude — the Harness state folder
# worfy-harness/ and the pre-plugin places gate/, profiles/, bin/, hooks/, skills/, agents/,
# CLAUDE.md, settings.json — with its size and mtime. A test takes it before and after its run and
# compares the two: a file created, deleted or rewritten there is a write into the real home.
#
# Live sessions keep writing into four folders while a test runs: worktree-sessions/ (the
# worktree lock), gate/state/ (gate markers and verdicts), profiles/*/state/ (the retro log) and
# skills/synced/ (Claude Code rewrites its synced skills about every 10 minutes). Their
# files are not listed by mtime; instead, with <marker> (the test's temporary directory) the
# snapshot lists every file there whose contents name the marker — a lock or a verdict of the test's
# own temporary repository. Claude Code's own folders (projects/, todos/, shell-snapshots/ and the
# rest) are not looked at: other sessions change them all the time. The four folders are matched on
# the path with / as the separator, so they are volatile on Windows too, where node joins paths with \;
# the marker is looked for as given and with that separator.
#
# real_home_diff prints the lines that differ between two snapshots (< before, > after), at most 10,
# indented: a test prints them under its failed check, so a real write can be told from noise.
real_home_snapshot() {
    node - "$1" "${2:-}" <<'NODE'
const fs = require("fs"), path = require("path")
const [home, marker] = process.argv.slice(2)
const claude = path.join(home, ".claude")
const VOLATILE = [/\/worktree-sessions(\/|$)/, /\/gate\/state(\/|$)/, /\/profiles\/[^/]+\/state(\/|$)/, /\/skills\/synced(\/|$)/]
const marks = marker ? [...new Set([marker, marker.split("/").join(path.sep)])] : []
const out = []
const walk = (p) => {
    let st
    try { st = fs.lstatSync(p) } catch { return }
    const volatile = VOLATILE.some((re) => re.test(p.split(path.sep).join("/")))
    if (st.isDirectory()) {
        let names = []
        try { names = fs.readdirSync(p).sort() } catch { return }
        for (const n of names) walk(path.join(p, n))
        return
    }
    if (!volatile) return out.push(`${p}\t${st.size}\t${st.mtimeMs}`)
    if (!marker || !st.isFile() || st.size > 1 << 20) return
    try {
        const text = fs.readFileSync(p, "utf8")
        if (marks.some((m) => text.includes(m))) out.push(`${p}\tnames ${marker}`)
    } catch {}
}
for (const part of ["worfy-harness", "gate", "profiles", "bin", "hooks", "skills", "agents", "CLAUDE.md", "settings.json"])
    walk(path.join(claude, part))
process.stdout.write(out.join("\n") + "\n")
NODE
}
real_home_diff() {
    diff <(printf '%s\n' "$1") <(printf '%s\n' "$2") | grep '^[<>]' | head -n 10 | sed 's/^/    /'
}
